// Small Supabase client: sign-in, database and live updates.
// Uses only fetch and WebSocket, so the app has no outside code to load.
'use strict';

const NET_TIMEOUT = 20000;          // give up on a request after 20 seconds (weak signal)

class SupaError extends Error {
  constructor(msg, status, code) { super(msg); this.status = status; this.code = code || ''; }
}

async function readError(res) {
  let msg = res.status + ' ' + res.statusText, code = '';
  try {
    const j = await res.json();
    msg = j.msg || j.error_description || j.message || j.error || msg;
    code = j.code || j.error_code || '';
  } catch (e) { /* not json */ }
  return new SupaError(msg, res.status, code);
}

// fetch that cannot hang forever
async function netFetch(url, opts, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms || NET_TIMEOUT) : 0;
  try {
    return await fetch(url, ctl ? Object.assign({ signal: ctl.signal }, opts) : opts);
  } finally {
    clearTimeout(timer);
  }
}

// true when a request failed because of the connection, not because the server said no
function isNetworkError(e) { return !e || !e.status || e.status >= 500 || e.name === 'TypeError' || e.name === 'AbortError'; }

class Supa {
  constructor(url, key, storeKey, bucket) {
    this.url = url;
    this.key = key;
    this.storeKey = storeKey;
    this.bucket = bucket;
    this.session = null;
    this.refreshing = null;
    try { this.session = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) { this.session = null; }
  }

  saveSession(s) {
    this.session = s;
    try {
      if (s) localStorage.setItem(this.storeKey, JSON.stringify(s));
      else localStorage.removeItem(this.storeKey);
    } catch (e) { /* storage blocked */ }
  }

  get email() { return this.session && this.session.user ? String(this.session.user.email || '').toLowerCase() : null; }

  headers() {
    return { apikey: this.key, Authorization: 'Bearer ' + (this.session ? this.session.access_token : this.key), 'Content-Type': 'application/json' };
  }

  // ---------- auth
  async authCall(path, body) {
    const res = await netFetch(this.url + '/auth/v1/' + path, {
      method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw await readError(res);
    return res.json();
  }

  storeTokens(j) {
    const exp = j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600);
    this.saveSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: exp, user: j.user });
  }

  async signIn(email, password) {
    const j = await this.authCall('token?grant_type=password', { email, password });
    this.storeTokens(j);
    return j;
  }

  // Returns true when signed in right away, false when a confirmation email was sent.
  async signUp(email, password, redirectTo) {
    const q = redirectTo ? 'signup?redirect_to=' + encodeURIComponent(redirectTo) : 'signup';
    const j = await this.authCall(q, { email, password });
    if (j.access_token) { this.storeTokens(j); return true; }
    return false;
  }

  // Get a new access token. True when it worked. Only one refresh runs at a time.
  refresh() {
    if (!this.session || !this.session.refresh_token) return Promise.resolve(false);
    if (!this.refreshing) {
      const token = this.session.refresh_token;
      this.refreshing = (async () => {
        try {
          const j = await this.authCall('token?grant_type=refresh_token', { refresh_token: token });
          this.storeTokens(j);
          return true;
        } catch (e) {
          if (e.status >= 400 && e.status < 500) this.saveSession(null);   // refresh token no longer valid
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async fresh() {
    if (this.session && this.session.expires_at - Date.now() / 1000 < 120) await this.refresh();
  }

  async signOut() {
    const s = this.session;
    this.saveSession(null);
    if (s) {
      try {
        await netFetch(this.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: this.key, Authorization: 'Bearer ' + s.access_token } });
      } catch (e) { /* offline is fine */ }
    }
  }

  // ---------- database (PostgREST)
  async rest(method, path, body, prefer, retried) {
    await this.fresh();
    const h = this.headers();
    if (prefer) h.Prefer = prefer;
    const res = await netFetch(this.url + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && this.session && !retried) {
      if (await this.refresh()) return this.rest(method, path, body, prefer, true);
      if (this.session) throw new SupaError('The sign-in could not be renewed. Check your signal.', 0);   // the renewal did not get through: treat it as no signal, not as signed out
    }
    if (!res.ok) throw await readError(res);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }

  insert(table, rows) { return this.rest('POST', table, rows, 'return=representation'); }

  upsert(table, rows, onConflict) {
    return this.rest('POST', table + '?on_conflict=' + onConflict, rows, 'resolution=merge-duplicates,return=representation');
  }

  update(table, filter, patch) { return this.rest('PATCH', table + '?' + filter, patch, 'return=representation'); }

  // returns the rows that were deleted (an empty list means nothing was deleted)
  remove(table, filter) { return this.rest('DELETE', table + '?' + filter, undefined, 'return=representation'); }

  rpc(fn, args) { return this.rest('POST', 'rpc/' + fn, args || {}); }

  // ---------- photo storage
  // Uploading the same file again is fine: "already exists" counts as done, so a retry after a dropped connection is safe.
  async upload(path, blob, contentType, retried) {
    await this.fresh();
    const h = { apikey: this.key, Authorization: 'Bearer ' + (this.session ? this.session.access_token : this.key), 'Content-Type': contentType, 'cache-control': 'max-age=31536000' };
    const res = await netFetch(this.url + '/storage/v1/object/' + this.bucket + '/' + path, { method: 'POST', headers: h, body: blob }, 90000);
    if (res.ok) return path;
    let j = {};
    try { j = await res.json(); } catch (e) { /* not json */ }
    const status = +j.statusCode || res.status, msg = j.message || j.error || (res.status + ' ' + res.statusText);
    if (status === 409 || /already exists|duplicate/i.test(msg)) return path;
    if ((status === 401 || /jwt/i.test(msg)) && this.session && !retried) {
      if (await this.refresh()) return this.upload(path, blob, contentType, true);
      if (this.session) throw new SupaError('The sign-in could not be renewed. Check your signal.', 0);   // same as above: no signal, not signed out
    }
    throw new SupaError(msg, /row-level security|unauthorized/i.test(msg + ' ' + (j.error || '')) && status < 401 ? 403 : status, String(j.error || ''));
  }

  async removeFiles(paths) {
    if (!paths.length) return;
    await this.fresh();
    const res = await netFetch(this.url + '/storage/v1/object/' + this.bucket, { method: 'DELETE', headers: this.headers(), body: JSON.stringify({ prefixes: paths }) });
    if (!res.ok) throw await readError(res);
  }

  publicUrl(path) { return this.url + '/storage/v1/object/public/' + this.bucket + '/' + path.split('/').map(encodeURIComponent).join('/'); }
}

// Live updates over the Supabase Realtime websocket (Phoenix protocol).
// It always listens with the public key: everyone may read, and that key never expires,
// so the connection does not drop when an editor's sign-in is renewed.
class Live {
  constructor(sb, name, tables, onChange, onStatus) {
    this.sb = sb; this.topic = 'realtime:' + name; this.tables = tables; this.onChange = onChange; this.onStatus = onStatus;
    this.ws = null; this.ref = 0; this.hb = 0; this.timer = 0; this.wait = 1000; this.up = false; this.stopped = true; this.seen = 0;
  }

  start() { this.stopped = false; this.open(); }

  stop() { this.stopped = true; clearTimeout(this.timer); this.close(); }

  // The page came back to the front, or the network returned: reconnect now unless the link looks healthy.
  kick() {
    if (this.stopped) return;
    if (this.ws && this.ws.readyState === 1 && this.up && Date.now() - this.seen < 40000) return;
    clearTimeout(this.timer);
    this.close();
    this.wait = 1000;
    this.open();
  }

  send(topic, event, payload) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ref += 1;
    this.ws.send(JSON.stringify({ topic, event, payload, ref: String(this.ref), join_ref: '1' }));
  }

  status(up) { if (up !== this.up) { this.up = up; this.onStatus(up); } }

  close() {
    clearInterval(this.hb);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch (e) { /* already closed */ }
    }
    this.status(false);
  }

  drop() { this.close(); this.retry(); }

  open() {
    if (this.stopped || this.ws) return;
    const u = this.sb.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(this.sb.key) + '&vsn=1.0.0';
    let ws;
    try { ws = new WebSocket(u); } catch (e) { this.retry(); return; }
    this.ws = ws;
    this.seen = Date.now();
    ws.onopen = () => {
      this.seen = Date.now();
      this.send(this.topic, 'phx_join', {
        config: { broadcast: { self: false }, presence: { key: '' },
          postgres_changes: this.tables.map(t => ({ event: '*', schema: 'public', table: t })) },
        access_token: this.sb.key
      });
      clearInterval(this.hb);
      this.hb = setInterval(() => {
        if (Date.now() - this.seen > 70000) { this.drop(); return; }       // the server went quiet: start over
        this.send('phoenix', 'heartbeat', {});
      }, 20000);
    };
    ws.onmessage = (m) => {
      this.seen = Date.now();
      let msg;
      try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (msg.event === 'phx_reply' && msg.topic === this.topic) {
        if (msg.payload && msg.payload.status === 'ok') { this.wait = 1000; this.status(true); }
        else this.drop();
      } else if (msg.event === 'postgres_changes' && msg.payload && msg.payload.data) {
        this.onChange(msg.payload.data.table, msg.payload.data);
      } else if (msg.event === 'system' && msg.topic === this.topic && msg.payload && msg.payload.extension === 'postgres_changes') {
        // "ok" confirms the database subscription; on an error the server keeps retrying by itself, so just show it
        this.status(msg.payload.status === 'ok');
      } else if ((msg.event === 'phx_error' || msg.event === 'phx_close') && msg.topic === this.topic) {
        this.drop();
      }
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; clearInterval(this.hb); this.status(false); this.retry(); } };
    ws.onerror = () => { /* onclose follows */ };
  }

  retry() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), this.wait);
    this.wait = Math.min(30000, this.wait * 2);
  }
}
