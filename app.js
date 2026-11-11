// Donato Plumbing - QA/QC Plumbing Rough-In app
'use strict';

const APP_URL = location.href.split('#')[0].split('?')[0];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TOTAL_UNITS = FLOORS.reduce((n, f) => n + f.units, 0);
const NEW_SECTION = '__new__';
const ANSWERS = [['Y', 'Y', 'Yes'], ['N', 'N', 'No'], ['NA', 'N/A', 'Not applicable']];
const BLANK_A = { answer: null, notes: '', corrective_action: '', responsible: '', due_date: null, corrected_on: null, verified_by: '' };
const BLANK_U = { inspected_on: null, inspected_by: '', comments: '' };
const PHOTO_MAX = 12;             // photos per deficiency
const DATE_FIELDS = { due_date: 1, corrected_on: 1, inspected_on: 1 };
const DEPTH = { home: 0, floor: 1, questions: 1, unit: 2, punch: 2, qnew: 2, qedit: 2, detail: 3 };
const BACK = '<svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.4 1.4 1.4 6.5l5 5.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const sb = new Supa(SB_URL, SB_KEY, 'dq_session', BUCKET);
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const two = n => String(n).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const akey = (f, u, q) => f + '|' + u + '|' + q;
const ukey = (f, u) => f + '|' + u;
const floorOf = f => FLOORS.find(x => x.floor === f);
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// "2026-11-10T23:35:12.123456+00:00" -> whole milliseconds, counted the same way the server counts them.
// Done by hand so every browser reads the database's timestamps identically.
function tsMs(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?\s*(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(String(s == null ? '' : s));
  if (!m) { const t = Date.parse(s); return isNaN(t) ? 0 : t; }
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + +((m[7] || '') + '000').slice(0, 3);
  const o = m[8];
  if (o && o !== 'Z') t -= (o[0] === '-' ? -1 : 1) * (+o.slice(1, 3) * 60 + (o.length > 3 ? +o.slice(-2) : 0)) * 60000;
  return t;
}
function fmtStamp(d) {
  const h = d.getHours();
  return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + '  ' + (h % 12 || 12) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function localInput(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes()); }
function fmtISODay(s) { if (!s) return ''; const [y, m, d] = String(s).split('-').map(Number); return MON[m - 1] + ' ' + d + ', ' + y; }
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }

// things kept on this phone (sign-in, a copy of the data for when there is no signal, changes waiting to upload)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

const S = {
  loaded: false,        // the checklist data is here (from the server, or the copy kept on this phone)
  failed: false,        // the first download failed and there is no copy on this phone
  q: {},                // questions by id
  ans: {},              // saved answers by "floor|unit|question"
  units: {},            // saved unit records by "floor|unit"
  project: { project_location: '', t: 0 },
  photos: {},           // saved photos of deficiencies, by id
  pend: {},             // photos still waiting to upload, by their local id
  blob: {},             // previews of photos uploaded from this phone, by file path
  out: store.get('dq_out', {}) || {},   // changes waiting to upload
  dead: {},             // rows deleted while a download was on its way
  editor: false, guest: false, live: false, netDown: false,
  rev: 0,               // goes up whenever anything shown could have changed
  seq: 0,               // goes up whenever data from the server is applied
  cacheRev: -1, stale: false, draft: null, ren: null, pf: 'open', detailBack: null, flashQ: null, newSec: null, tap: null,
  day: todayISO()
};

// the back button row sticks just under the header, so it can be reached without scrolling up
(() => {
  const hdr = document.querySelector('header');
  const setH = () => document.documentElement.style.setProperty('--hh', hdr.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(setH).observe(hdr);
  window.addEventListener('resize', setH); setH();
  window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 6), { passive: true });
})();

// ---------------------------------------------------------------- the checklist: questions, answers, results
let qlCache = null;
// Active questions in checklist order, numbered 1, 2, 3 ... and grouped into sections.
function QL() {
  if (qlCache && qlCache.rev === S.rev) return qlCache;
  const all = Object.keys(S.q).map(k => S.q[k]);
  const byPos = (a, b) => a.position - b.position || a.id - b.id;
  const secs = [], byName = {}, list = [], byId = {};
  all.filter(q => !q.removed).sort(byPos).forEach(q => {
    let s = byName[q.section];
    if (!s) { s = byName[q.section] = { name: q.section, i: secs.length, items: [] }; secs.push(s); }
    s.items.push({ id: q.id, n: 0, section: q.section, question: q.question, pa: q.problem_answer, position: q.position, sec: s });
  });
  let n = 0;
  secs.forEach(s => s.items.forEach(it => { it.n = ++n; list.push(it); byId[it.id] = it; }));
  qlCache = { rev: S.rev, list, secs, byId, removed: all.filter(q => q.removed).sort(byPos) };
  return qlCache;
}

// what is on screen for one answer: the saved row plus any change still waiting to upload
function ansRow(f, u, qid) {
  const k = akey(f, u, qid), s = S.ans[k], o = S.out['a|' + k];
  if (!o) return s || null;
  return Object.assign({}, BLANK_A, s, o.p);
}
function unitRow(f, u) {
  const k = ukey(f, u), s = S.units[k], o = S.out['u|' + k];
  if (!o) return s || BLANK_U;
  return Object.assign({}, BLANK_U, s, o.p);
}

// Same rule as the tracker: N/A is N/A; a Y or N that matches the question's problem answer is a deficiency; otherwise OK.
function resultOf(answer, pa) {
  if (!answer) return '';
  if (answer === 'NA') return 'na';
  return answer === pa ? 'def' : 'ok';
}
// Closed once "Corrected on" has a date; Overdue once the due date has passed; otherwise Open.
function defStatus(r, day) {
  if (r.corrected_on) return 'closed';
  return r.due_date && r.due_date < (day || todayISO()) ? 'overdue' : 'open';
}
function hasDetails(r) { return !!(r.notes || r.corrective_action || r.responsible || r.due_date || r.corrected_on || r.verified_by); }

let statCache = { rev: -1, day: '', units: {} };
// Not started: nothing answered. Fail: any open or overdue deficiency. Pass: every item answered and none open. Otherwise in progress.
function unitStats(f, u) {
  const day = todayISO();
  if (statCache.rev !== S.rev || statCache.day !== day) statCache = { rev: S.rev, day, units: {} };
  const k = ukey(f, u);
  if (statCache.units[k]) return statCache.units[k];
  const list = QL().list;
  let answered = 0, defs = 0, open = 0, overdue = 0, closed = 0;
  for (let i = 0; i < list.length; i++) {
    const q = list[i], r = ansRow(f, u, q.id);
    if (!r || !r.answer) continue;
    answered++;
    if (resultOf(r.answer, q.pa) !== 'def') continue;
    defs++;
    const st = defStatus(r, day);
    if (st === 'closed') closed++; else { open++; if (st === 'overdue') overdue++; }
  }
  const total = list.length;
  const result = answered === 0 ? 'none' : open > 0 ? 'fail' : answered >= total ? 'pass' : 'prog';
  return (statCache.units[k] = { total, answered, defs, open, overdue, closed, result });
}

function floorStats(fl) {
  const s = { pass: 0, fail: 0, prog: 0, none: 0, answered: 0, total: 0, defs: 0, open: 0, overdue: 0, closed: 0 };
  for (let u = 1; u <= fl.units; u++) {
    const st = unitStats(fl.floor, u);
    s[st.result]++; s.answered += st.answered; s.total += st.total; s.defs += st.defs; s.open += st.open; s.overdue += st.overdue; s.closed += st.closed;
  }
  return s;
}

// every deficiency on a floor, in unit order then checklist order (the punch list)
function floorDefs(fl) {
  const list = QL().list, out = [], day = todayISO();
  for (let u = 1; u <= fl.units; u++) {
    for (let i = 0; i < list.length; i++) {
      const q = list[i], r = ansRow(fl.floor, u, q.id);
      if (r && resultOf(r.answer, q.pa) === 'def') out.push({ u, q, r, st: defStatus(r, day) });
    }
  }
  return out;
}

const RES = { pass: ['ok', 'Pass'], fail: ['bad', 'Fail'], prog: ['prog', 'In progress'], none: ['todo', 'Not started'] };
const DST = { open: ['warn', 'Open'], overdue: ['bad', 'Overdue'], closed: ['ok', 'Closed'] };
const resPill = r => '<span class="pill ' + RES[r][0] + '">' + RES[r][1] + '</span>';
const defPill = s => '<span class="pill ' + DST[s][0] + '">' + DST[s][1] + '</span>';

// ---------------------------------------------------------------- toasts, sheets, busy
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function openSheet(html, onMount) {
  const wrap = $('#sheetWrap');
  wrap.innerHTML = '<div class="dim"></div><div class="sheet">' + html + '</div>';
  wrap.classList.add('on');
  const close = () => { wrap.classList.remove('on'); wrap.innerHTML = ''; };
  $('.dim', wrap).onclick = close;
  if (onMount) onMount($('.sheet', wrap), close);
  return close;
}

function choose(title, options, text) {          // options: [{label, value, style}]
  return new Promise(res => {
    const close = openSheet('<div class="sh-title">' + esc(title) + '</div>' + (text ? '<div class="sh-text">' + esc(text) + '</div>' : '') +
      options.map((o, i) => '<button type="button" class="sh-btn ' + (o.style || '') + '" data-i="' + i + '">' + esc(o.label) + '</button>').join('') +
      '<button type="button" class="sh-btn cancel" data-i="-1">Cancel</button>', (el, done) => {
      el.querySelectorAll('button').forEach(b => b.onclick = () => { done(); const i = +b.dataset.i; res(i < 0 ? null : options[i].value); });
    });
    $('#sheetWrap .dim').onclick = () => { close(); res(null); };
  });
}

function busy(msg) {
  const b = $('#busy');
  if (msg === false) { b.classList.remove('on'); return; }
  b.querySelector('.bmsg').textContent = msg;
  b.classList.add('on');
}

function saveErrorText(e) {
  if (isNetworkError(e)) return 'No signal. Try again when you have signal.';
  if (e.status === 401 || e.status === 403 || e.code === '42501') return 'Your email isn’t on the editor list.';
  return 'Couldn’t save: ' + e.message;
}

// ---------------------------------------------------------------- data from the server
function bump() { S.rev++; }

// Rows as the database sends them (API replies and live updates). A row only replaces an older one.
// Each returns 1 when something changed, 0 when it is the copy we already have, -1 when it is older than ours.
function sameFields(a, b, keys) { return keys.every(k => a[k] === b[k]); }
const A_KEYS = ['answer', 'notes', 'corrective_action', 'responsible', 'due_date', 'corrected_on', 'verified_by'];
const U_KEYS = ['inspected_on', 'inspected_by', 'comments'];
const Q_KEYS = ['section', 'question', 'problem_answer', 'position', 'removed'];
function putAnswer(r) {
  const k = akey(r.floor, r.unit, r.question_id), t = tsMs(r.updated_at), old = S.ans[k];
  if (old && old.t > t) return -1;
  const row = { floor: r.floor, unit: r.unit, question_id: r.question_id, answer: r.answer || null, notes: r.notes || '', corrective_action: r.corrective_action || '',
    responsible: r.responsible || '', due_date: r.due_date || null, corrected_on: r.corrected_on || null, verified_by: r.verified_by || '', t, s: S.seq + 1 };
  if (old && old.t === t && sameFields(old, row, A_KEYS)) return 0;
  S.ans[k] = row;
  return 1;
}
function putUnit(r) {
  const k = ukey(r.floor, r.unit), t = tsMs(r.updated_at), old = S.units[k];
  if (old && old.t > t) return -1;
  const row = { floor: r.floor, unit: r.unit, inspected_on: r.inspected_on || null, inspected_by: r.inspected_by || '', comments: r.comments || '', t, s: S.seq + 1 };
  if (old && old.t === t && sameFields(old, row, U_KEYS)) return 0;
  S.units[k] = row;
  return 1;
}
function putQuestion(r) {
  const t = tsMs(r.updated_at), old = S.q[r.id];
  if (old && old.t > t) return -1;
  const row = { id: r.id, section: r.section, question: r.question, problem_answer: r.problem_answer, position: +r.position, removed: !!r.removed_at, t, s: S.seq + 1 };
  if (old && old.t === t && sameFields(old, row, Q_KEYS)) return 0;
  S.q[r.id] = row;
  return 1;
}
function putProject(r) {
  const t = tsMs(r.updated_at), loc = r.project_location || '';
  if (S.project.t > t) return -1;
  if (S.project.t === t && S.project.project_location === loc) return 0;
  S.project = { project_location: loc, t };
  return 1;
}
function putPhoto(r) {                          // photos never change once saved
  if (S.photos[r.id]) return 0;
  S.photos[r.id] = { id: r.id, floor: r.floor, unit: r.unit, question_id: r.question_id, path: r.path, taken: r.taken_at ? tsMs(r.taken_at) : null, t: tsMs(r.created_at), s: S.seq + 1 };
  return 1;
}
function applied() { S.seq++; bump(); }

// a live update from another phone (or the echo of our own change)
function onLiveChange(table, d) {
  if (d.errors && d.errors.length) { scheduleRefresh(); return; }       // the update came through incomplete: fetch a fresh copy instead
  let res;
  if (d.type === 'DELETE') {
    const o = d.old_record || {};
    if (table === 'roughin_answers' && o.floor != null && o.unit != null && o.question_id != null) { const k = akey(o.floor, o.unit, o.question_id); delete S.ans[k]; S.dead['a|' + k] = S.seq + 1; res = 1; }
    else if (table === 'roughin_units' && o.floor != null && o.unit != null) { const k = ukey(o.floor, o.unit); delete S.units[k]; S.dead['u|' + k] = S.seq + 1; res = 1; }
    else if (table === 'roughin_questions' && o.id != null) { delete S.q[o.id]; S.dead['q|' + o.id] = S.seq + 1; res = 1; }
    else if (table === 'roughin_photos' && o.id != null) { delete S.photos[o.id]; S.dead['ph|' + o.id] = S.seq + 1; res = 1; }
  } else if (d.record) {
    if (table === 'roughin_answers') res = putAnswer(d.record);
    else if (table === 'roughin_units') res = putUnit(d.record);
    else if (table === 'roughin_questions') res = putQuestion(d.record);
    else if (table === 'roughin_project') { res = putProject(d.record); if (res > 0) showAddress(); }
    else if (table === 'roughin_photos') res = putPhoto(d.record);
  }
  if (res === undefined) { scheduleRefresh(); return; }                  // a message we can't read: fetch a fresh copy instead
  if (res > 0) { applied(); scheduleRender(); if (table === 'roughin_photos') refreshPhotos(); }
  else if (res < 0) scheduleCheck();                                     // older than what we have: make sure we are in step
}

// Put a full download in place. Anything that arrived while it was on its way (seq > seq0) is newer and is kept.
function applySnapshot(s, seq0) {
  const q = {}, ans = {}, units = {}, photos = {};
  (s.photos || []).forEach(a => {
    if (S.dead['ph|' + a[0]] > seq0) return;
    photos[a[0]] = S.photos[a[0]] || { id: a[0], floor: a[1], unit: a[2], question_id: a[3], path: a[4], taken: a[5] == null ? null : a[5], t: a[6] || 0, s: 0 };
  });
  Object.keys(S.photos).forEach(k => { if (!photos[k] && S.photos[k].s > seq0) photos[k] = S.photos[k]; });
  (s.questions || []).forEach(r => {
    if (S.dead['q|' + r.id] > seq0) return;
    const row = { id: r.id, section: r.section, question: r.question, problem_answer: r.problem_answer, position: +r.position, removed: !!r.removed, t: r.t || 0, s: 0 }, old = S.q[r.id];
    q[r.id] = old && old.t > row.t ? old : row;
  });
  (s.answers || []).forEach(a => {
    const k = akey(a[0], a[1], a[2]);
    if (S.dead['a|' + k] > seq0) return;
    const row = { floor: a[0], unit: a[1], question_id: a[2], answer: a[3] || null, t: a[4] || 0, notes: a[5] || '', corrective_action: a[6] || '', responsible: a[7] || '',
      due_date: a[8] || null, corrected_on: a[9] || null, verified_by: a[10] || '', s: 0 }, old = S.ans[k];
    ans[k] = old && old.t > row.t ? old : row;
  });
  (s.units || []).forEach(a => {
    const k = ukey(a[0], a[1]);
    if (S.dead['u|' + k] > seq0) return;
    const row = { floor: a[0], unit: a[1], inspected_on: a[2] || null, inspected_by: a[3] || '', comments: a[4] || '', t: a[5] || 0, s: 0 }, old = S.units[k];
    units[k] = old && old.t > row.t ? old : row;
  });
  Object.keys(S.q).forEach(k => { if (!q[k] && S.q[k].s > seq0) q[k] = S.q[k]; });
  Object.keys(S.ans).forEach(k => { if (!ans[k] && S.ans[k].s > seq0) ans[k] = S.ans[k]; });
  Object.keys(S.units).forEach(k => { if (!units[k] && S.units[k].s > seq0) units[k] = S.units[k]; });
  S.q = q; S.ans = ans; S.units = units; S.photos = photos; S.dead = {};
  if (s.project && (s.project.t || 0) >= S.project.t) S.project = { project_location: s.project.project_location || '', t: s.project.t || 0 };
  S.loaded = true; S.failed = false;
  bump();
  showAddress();
}

// the same shape the server sends, built from what this phone has (kept for when there is no signal)
function exportSnapshot() {
  return {
    project: { project_location: S.project.project_location, t: S.project.t },
    questions: Object.keys(S.q).map(k => { const q = S.q[k]; return { id: q.id, section: q.section, question: q.question, problem_answer: q.problem_answer, position: q.position, removed: q.removed, t: q.t }; }),
    answers: Object.keys(S.ans).map(k => { const a = S.ans[k]; return hasDetails(a) ? [a.floor, a.unit, a.question_id, a.answer, a.t, a.notes, a.corrective_action, a.responsible, a.due_date, a.corrected_on, a.verified_by] : [a.floor, a.unit, a.question_id, a.answer, a.t]; }),
    units: Object.keys(S.units).map(k => { const u = S.units[k]; return [u.floor, u.unit, u.inspected_on, u.inspected_by, u.comments, u.t]; }),
    photos: Object.keys(S.photos).map(k => { const p = S.photos[k]; return [p.id, p.floor, p.unit, p.question_id, p.path, p.taken, p.t]; })
  };
}
function saveCache() {
  if (!S.loaded || S.cacheRev === S.rev) return;
  if (store.set('dq_cache', exportSnapshot())) S.cacheRev = S.rev;
}
function loadCache() {
  const c = store.get('dq_cache', null);
  if (!c || !Array.isArray(c.questions) || !c.questions.length) return;
  try { applySnapshot(c, S.seq); S.cacheRev = S.rev; } catch (e) { S.q = {}; S.ans = {}; S.units = {}; S.photos = {}; S.loaded = false; bump(); }
}

let refreshing = false, refreshAgain = false, refreshTimer = 0;
async function refresh() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const seq0 = S.seq;
    const snap = await sb.rpc('roughin_snapshot');
    if (!snap || !Array.isArray(snap.questions)) throw new Error('unexpected reply');
    applySnapshot(snap, seq0);
    setNet(true);
    saveCache();
    render(); refreshPhotos();
  } catch (e) {
    if (isNetworkError(e)) setNet(false);
    if (!S.loaded) { S.failed = true; render(); }
  }
  refreshing = false;
  if (refreshAgain) { refreshAgain = false; refresh(); }
}
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 400); }
let checkTimer = 0;
function scheduleCheck() { clearTimeout(checkTimer); checkTimer = setTimeout(checkVersion, 2500); }

// a cheap check that this phone has exactly what the server has; downloads again only when it does not
function localVersion() {
  const agg = o => { let n = 0, m = 0; for (const k in o) { n++; if (o[k].t > m) m = o[k].t; } return [n, m]; };
  return { q: agg(S.q), a: agg(S.ans), u: agg(S.units), p: [1, S.project.t], ph: agg(S.photos) };
}
let checking = false;
async function checkVersion() {
  if (checking || refreshing) return;
  if (!S.loaded) { refresh(); return; }
  checking = true;
  try {
    const v = await sb.rpc('roughin_version'), l = localVersion();
    setNet(true);
    if (!v || ['q', 'a', 'u', 'p', 'ph'].some(k => !v[k] || v[k][0] !== l[k][0] || v[k][1] !== l[k][1])) refresh();
  } catch (e) { if (isNetworkError(e)) setNet(false); }
  checking = false;
}

function setNet(ok) {
  if (S.netDown === !ok) return;
  S.netDown = !ok;
  scheduleRender();
}

// ---------------------------------------------------------------- changes made on this phone
function saveOut() { store.set('dq_out', S.out); }
function pendingCount() { return Object.keys(S.out).length; }

// kind 'a' = an answer row, 'u' = a unit record. The change shows right away and is uploaded as soon as possible.
function queue(kind, f, u, qid, patch) {
  const key = kind === 'a' ? 'a|' + akey(f, u, qid) : 'u|' + ukey(f, u);
  let e = S.out[key];
  if (!e) e = S.out[key] = { k: kind, f, u, q: qid || 0, p: {}, v: 0 };
  Object.assign(e.p, patch);
  e.v++;
  saveOut();
  bump();
}

let flushing = false, flushAgain = false;
async function flush() {
  if (flushing) { flushAgain = true; return; }
  if (!S.editor || !sb.session || !pendingCount()) return;
  flushing = true;
  let size = 200, lost = 0, hadDown = S.netDown;
  try {
    for (let round = 0; round < 400 && pendingCount(); round++) {
      // rows in one request must all carry the same columns, so group by table and by which fields changed
      const groups = {};
      Object.keys(S.out).forEach(key => { const e = S.out[key], sig = e.k + ':' + Object.keys(e.p).sort().join(','); (groups[sig] = groups[sig] || []).push(key); });
      const keys = groups[Object.keys(groups)[0]].slice(0, size);
      const isA = S.out[keys[0]].k === 'a';
      const sent = keys.map(key => ({ key, v: S.out[key].v }));
      const rows = keys.map(key => { const e = S.out[key]; return Object.assign(isA ? { floor: e.f, unit: e.u, question_id: e.q } : { floor: e.f, unit: e.u }, e.p); });
      let back;
      try {
        back = await sb.upsert(isA ? 'roughin_answers' : 'roughin_units', rows, isA ? 'floor,unit,question_id' : 'floor,unit');
      } catch (err) {
        if (isNetworkError(err)) { setNet(false); break; }                                   // no signal: keep everything and try again later
        if (err.status === 401 || err.status === 403 || err.code === '42501') { flushing = false; await lostAccess(); return; }
        if (keys.length > 1) { size = 1; continue; }                                          // one bad row must not hold up the rest
        delete S.out[keys[0]]; lost++; saveOut(); bump();
        continue;
      }
      setNet(true);
      (back || []).forEach(r => (isA ? putAnswer(r) : putUnit(r)));
      applied();
      sent.forEach(x => { const e = S.out[x.key]; if (e && e.v === x.v) delete S.out[x.key]; });
      saveOut();
    }
  } finally {
    flushing = false;
  }
  if (lost) toast(plural(lost, 'change', 'changes') + ' couldn’t be saved.', 4200);
  if (S.netDown && !hadDown && pendingCount()) toast('No signal. Your changes are saved on this phone and upload when you have signal.', 4200);
  scheduleRender();
  if (flushAgain) { flushAgain = false; flush(); }
}

// the server refused a change: signed out somewhere else, or no longer on the editor list
async function lostAccess() {
  await checkEditor();
  if (S.editor) return;
  toast(sb.session ? 'Your email isn’t on the editor list any more.' : 'You’ve been signed out. Sign in again to keep editing.', 4200);
  if (sb.session) await sb.signOut();
  await exitToStart();
}

// Is the signed-in person on the editor list? With no signal, go by the last answer the server gave for this email.
async function checkEditor() {
  if (!sb.session) { S.editor = false; return; }
  try {
    S.editor = (await sb.rpc('is_editor')) === true;
    if (S.editor) store.set('dq_ed', sb.email); else store.del('dq_ed');
  } catch (e) {
    if (isNetworkError(e)) S.editor = !!sb.session && store.get('dq_ed', null) === sb.email;
    else S.editor = false;
  }
}

// ---------------------------------------------------------------- routing
function route() {
  const h = location.hash;
  let m = h.match(/^#\/f\/(\d+)(?:\/(punch)|\/u\/(\d+)(?:\/(d|q)\/(\d+))?)?\/?$/);
  if (m) {
    const fl = floorOf(+m[1]);
    if (fl) {
      if (m[2]) return { view: 'punch', floor: fl.floor };
      const u = m[3] ? +m[3] : 0;
      if (u >= 1 && u <= fl.units) {
        if (m[4] === 'd' && S.editor) return { view: 'detail', floor: fl.floor, unit: u, q: +m[5] };
        return { view: 'unit', floor: fl.floor, unit: u, q: m[4] ? +m[5] : 0 };
      }
      return { view: 'floor', floor: fl.floor };
    }
  }
  if (S.editor) {                                      // the question list is for editors only
    if (/^#\/questions\/?$/.test(h)) return { view: 'questions' };
    if (/^#\/questions\/new\/?$/.test(h)) return { view: 'qnew' };
    m = h.match(/^#\/questions\/e\/(\d+)\/?$/);
    if (m) return { view: 'qedit', id: +m[1] };
  }
  return { view: 'home' };
}

const scrollMem = {};
let curHash = location.hash, curRoute = route();
window.addEventListener('hashchange', () => {
  const prev = curRoute, prevHash = curHash;
  scrollMem[prevHash] = window.scrollY;
  curHash = location.hash; curRoute = route();
  if (curRoute.view === 'detail') S.detailBack = prev.view === 'punch' ? prevHash : null;
  if (curRoute.view !== 'qnew' && curRoute.view !== 'qedit') S.draft = null;
  if (curRoute.view !== 'questions') S.ren = null;
  render({ force: true });
  if (curRoute.view === 'unit' && curRoute.q) scrollToEl('q' + curRoute.q);
  else if (curRoute.view === 'questions' && S.flashQ) scrollToEl('qm' + S.flashQ);
  else window.scrollTo(0, DEPTH[curRoute.view] < DEPTH[prev.view] ? (scrollMem[curHash] || 0) : 0);
  S.flashQ = null;
});

function scrollToEl(id) {
  const el = document.getElementById(id);
  if (!el) { window.scrollTo(0, 0); return; }
  const r = el.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, window.scrollY + r.top + r.height / 2 - window.innerHeight / 2));
  el.classList.add('flash');
}

// ---------------------------------------------------------------- drawing
let renderTimer = 0;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 60); }

// someone is in the middle of typing or picking a date: don't redraw under their fingers
function typing() {
  const a = document.activeElement;
  return !!(a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
document.addEventListener('focusout', () => setTimeout(() => { if (S.stale && !typing()) render(); }, 60));

function render(opts) {
  clearTimeout(renderTimer);
  const r = curRoute = route();
  const right = $('#tbRight');
  if (r.view === 'home') {
    let pass = 0;
    if (S.loaded) FLOORS.forEach(fl => { pass += floorStats(fl).pass; });
    right.innerHTML = S.loaded ? '<span class="tb-sub">' + pass + ' of ' + TOTAL_UNITS + ' units passed</span>' : '';
  } else right.textContent = r.view === 'floor' || r.view === 'punch' ? 'FLOOR ' + r.floor : r.view === 'unit' || r.view === 'detail' ? 'UNIT ' + r.unit : 'QUESTIONS';
  if (!S.loaded) {
    view.innerHTML = S.failed ? '<div class="empty">Can’t reach the server right now.<br>Check your signal and try again.<button type="button" class="btn" data-act="retry">Try again</button></div>' : '<div class="empty">Loading…</div>';
    return;
  }
  if (typing() && !(opts && opts.force)) { S.stale = true; return; }
  S.stale = false;
  const y = window.scrollY;
  view.style.setProperty('--nw', QL().list.length > 99 ? '35px' : '27px');      // room for three-digit item numbers
  view.innerHTML = VIEWS[r.view](r);
  if (window.scrollY !== y) window.scrollTo(0, y);
}

function modeBar() {
  const live = '<span class="live ' + (S.live ? 'up' : '') + '"><i></i>' + (S.live ? 'Live' : 'Connecting') + '</span>';
  if (S.editor) return '<div class="mbar"><span class="pill pe">✓ Editor</span>' + live + '<button type="button" class="link" data-act="signout">Sign out</button></div>';
  return '<div class="mbar"><span class="pill pv">View only</span>' + live + '</div>';     // guests: no sign-in link here
}

function pendingNote() {
  const n = pendingCount();
  if (!n) return '';
  if (!S.editor) return '<div class="note">' + plural(n, 'change is', 'changes are') + ' saved on this phone. Sign in as an editor to upload ' + (n === 1 ? 'it' : 'them') + '.</div>';
  if (S.netDown || navigator.onLine === false) return '<div class="note">No signal. ' + plural(n, 'change is', 'changes are') + ' saved on this phone and will upload when you have signal.</div>';
  return '';
}

function showAddress() { $('.st-addr').textContent = S.project.project_location; }

const VIEWS = {};

// ---------------------------------------------------------------- floors
VIEWS.home = () => {
  let h = modeBar() + pendingNote();
  h += '<div class="flds"><div class="fld"><b>Project / Location:</b>' +
    (S.editor ? '<input class="fin" data-pf="project_location" value="' + esc(S.project.project_location) + '" autocomplete="off" maxlength="200">' : '<span class="fv">' + esc(S.project.project_location) + '</span>') + '</div></div>';
  h += '<div class="sh"><i class="dot on"></i>FLOORS</div>';
  h += '<div class="ul">' + FLOORS.map(fl => {
    const st = floorStats(fl);
    const pill = st.total && st.pass === fl.units ? '<span class="pill ok">Passed</span>' : st.answered ? '<span class="pill prog">In progress</span>' : '<span class="pill todo">Not started</span>';
    return '<a class="uc" href="#/f/' + fl.floor + '"><div class="urw"><span>Floor ' + fl.floor + '</span>' + pill + '</div>' +
      '<div class="bar"><i style="width:' + (st.total ? 100 * st.answered / st.total : 0).toFixed(1) + '%"></i></div>' +
      '<div class="mt">' + st.pass + ' of ' + fl.units + ' units passed' + (st.open ? ' · <span class="red">' + st.open + ' open</span>' : '') + '</div></a>';
  }).join('') + '</div>';
  if (S.editor) {
    const ql = QL();
    h += '<div class="sh"><i class="dot ed"></i>EDITORS ONLY</div>';
    h += '<div class="ul"><a class="uc nb" href="#/questions"><div class="urw"><span>Checklist questions</span><span class="go">›</span></div>' +
      '<div class="mt">' + plural(ql.list.length, 'question', 'questions') + ' in ' + plural(ql.secs.length, 'section', 'sections') + ' · add, edit or remove</div></a></div>';
  }
  return h;
};

VIEWS.floor = r => {
  const fl = floorOf(r.floor), f = fl.floor, st = floorStats(fl);
  let h = '<div class="srow"><a class="bk" href="#/">' + BACK + 'All floors</a><span>' + st.pass + ' of ' + fl.units + ' units passed</span></div>' + pendingNote();
  h += '<div class="kp"><div class="' + (st.pass ? 'g' : 'z') + '"><b>' + st.pass + '</b><span>Passed</span></div><div class="' + (st.fail ? 'r' : 'z') + '"><b>' + st.fail + '</b><span>Failed</span></div>' +
    '<div class="' + (st.prog ? 'n' : 'z') + '"><b>' + st.prog + '</b><span>In progress</span></div><div class="z"><b>' + st.none + '</b><span>Not started</span></div></div>';
  h += '<div class="ul"><a class="uc nb" href="#/f/' + f + '/punch"><div class="urw"><span>Punch list</span>' +
    (st.open ? '<span class="pill warn">' + st.open + ' open</span>' : '<span class="pill todo">None open</span>') + '</div>' +
    '<div class="mt">' + (st.defs ? plural(st.defs, 'deficiency', 'deficiencies') + ' on this floor' + (st.overdue ? ' · <span class="red">' + st.overdue + ' overdue</span>' : '') + (st.closed ? ' · ' + st.closed + ' closed' : '')
      : 'No deficiencies on this floor') + '</div></a></div>';
  h += '<div class="sh"><i class="dot on"></i>UNITS</div><div class="ul two">';
  for (let u = 1; u <= fl.units; u++) {
    const us = unitStats(f, u);
    h += '<a class="uc" href="#/f/' + f + '/u/' + u + '"><div class="urw"><span>Unit ' + u + '</span>' + resPill(us.result) + '</div>' +
      '<div class="bar"><i style="width:' + (us.total ? 100 * us.answered / us.total : 0).toFixed(1) + '%"></i></div>' +
      '<div class="mt">' + us.answered + ' of ' + us.total + ' answered' + (us.open ? ' · <span class="red">' + us.open + ' open</span>' : '') + '</div></a>';
  }
  return h + '</div>';
};

// ---------------------------------------------------------------- one unit: the checklist
function unitCount(st) { return st.answered + ' of ' + st.total + ' answered' + (st.total && st.answered >= st.total ? ' ✓' : ''); }

function unitResLine(st) {
  let t;
  if (st.result === 'none') t = 'Nothing answered yet';
  else if (st.result === 'pass') t = 'All ' + st.total + ' items answered, no open deficiencies';
  else if (st.result === 'fail') t = plural(st.open, 'open deficiency', 'open deficiencies') + (st.overdue ? ' · ' + st.overdue + ' overdue' : '');
  else t = plural(st.total - st.answered, 'item', 'items') + ' left to answer';
  if (st.closed) t += ' · ' + st.closed + ' closed';
  return resPill(st.result) + '<span>' + t + '</span>';
}

function secCount(f, u, sec) {
  let n = 0;
  sec.items.forEach(q => { const r = ansRow(f, u, q.id); if (r && r.answer) n++; });
  const done = n >= sec.items.length;
  return '<span id="sc' + sec.i + '"' + (done ? ' class="okc"' : '') + '>' + n + ' of ' + sec.items.length + (done ? ' ✓' : '') + '</span>';
}

function defBlock(f, u, q, r) {
  const st = defStatus(r), ed = S.editor, tag = ed ? 'button' : 'div';
  let h = '<' + tag + (ed ? ' type="button" data-det="' + q.id + '"' : '') + ' class="df ' + st + '"><span class="dh"><b>Deficiency</b>' + defPill(st) +
    (ed ? '<span class="dl">' + (hasDetails(r) || photosOf(f, u, q.id).length ? 'Edit details' : 'Add details') + ' ›</span>' : '') + '</span>';
  h += defDetails(r) + photoStrip(f, u, q.id);
  return h + '</' + tag + '>';
}

function defDetails(r) {
  let h = '';
  if (r.notes) h += '<span class="dn">' + esc(r.notes) + '</span>';
  const m = [];
  if (r.corrective_action) m.push('<span><b>Fix:</b> ' + esc(r.corrective_action) + '</span>');
  if (r.responsible) m.push('<span><b>Responsible:</b> ' + esc(r.responsible) + '</span>');
  if (r.due_date) m.push('<span><b>Due:</b> ' + esc(fmtISODay(r.due_date)) + '</span>');
  if (r.corrected_on) m.push('<span><b>Corrected:</b> ' + esc(fmtISODay(r.corrected_on)) + '</span>');
  if (r.verified_by) m.push('<span><b>Verified by:</b> ' + esc(r.verified_by) + '</span>');
  if (m.length) h += '<span class="dm">' + m.join('') + '</span>';
  return h;
}

function rowHtml(f, u, q) {
  const r = ansRow(f, u, q.id), a = r ? r.answer : null, res = resultOf(a, q.pa);
  let h = '<div class="q" id="q' + q.id + '"><div class="qn">' + q.n + '.</div><div class="qt">' + esc(q.question) + '</div><div class="qa">';
  ANSWERS.forEach(o => {
    const on = a === o[0];
    h += '<button type="button" class="ab' + (on ? ' on ' + res : '') + '" data-q="' + q.id + '" data-a="' + o[0] + '" aria-pressed="' + on + '" aria-label="Item ' + q.n + ': ' + o[2] + '"' + (S.editor ? '' : ' disabled') + '>' + o[1] + '</button>';
  });
  h += '</div>';
  if (res === 'def') h += defBlock(f, u, q, r);
  return h + '</div>';
}

VIEWS.unit = r => {
  const f = r.floor, u = r.unit, fl = floorOf(f), ql = QL(), st = unitStats(f, u), ur = unitRow(f, u), ed = S.editor;
  let h = '<div class="srow"><a class="bk" href="#/f/' + f + '">' + BACK + 'Floor ' + f + '</a><span id="uCount"' + (st.total && st.answered >= st.total ? ' class="okc"' : '') + '>' + unitCount(st) + '</span></div>' + pendingNote();
  h += '<div class="ures" id="uRes">' + unitResLine(st) + '</div>';
  h += '<div class="flds"><div class="fld s"><b>Inspected on:</b>' + (ed ? '<input type="date" class="fin" data-uf="inspected_on" value="' + esc(ur.inspected_on || '') + '">' : '<span class="fv">' + esc(fmtISODay(ur.inspected_on)) + '</span>') + '</div>' +
    '<div class="fld s"><b>Inspected by:</b>' + (ed ? '<input class="fin" data-uf="inspected_by" value="' + esc(ur.inspected_by) + '" autocomplete="name" maxlength="200">' : '<span class="fv">' + esc(ur.inspected_by) + '</span>') + '</div></div>';
  if (!ql.list.length) return h + '<div class="empty">There are no questions on the checklist yet.' + (ed ? '<a class="btn" href="#/questions">Checklist questions</a>' : '') + '</div>';
  if (ed) h += '<div class="hint">Tap Y, N or N/A for each item. Tap the same box again to clear it.</div>';
  ql.secs.forEach(sec => {
    h += '<div class="sec2">' + esc(sec.name) + secCount(f, u, sec) + '</div>';
    sec.items.forEach(q => { h += rowHtml(f, u, q); });
  });
  h += '<div class="cmt"><div class="sec2">Unit comments</div>' +
    (ed ? '<textarea class="inp ta" data-uf="comments" maxlength="4000" placeholder="Anything worth noting about this unit" style="margin-top:12px">' + esc(ur.comments) + '</textarea>'
      : ur.comments ? '<div class="cmt-v" style="margin-top:10px">' + esc(ur.comments) + '</div>' : '<div class="mt" style="margin-top:10px">No comments.</div>') + '</div>';
  h += '<div class="actions">' + (u < fl.units ? '<a class="btn" href="#/f/' + f + '/u/' + (u + 1) + '">Next: Unit ' + (u + 1) + '</a>' : '') +
    '<a class="btn alt" href="#/f/' + f + '/punch">Floor ' + f + ' punch list</a></div>';
  return h;
};

// after a tap, redraw just that row and the counts (the page does not jump)
function refreshRow(f, u, qid) {
  const el = document.getElementById('q' + qid), q = QL().byId[qid];
  if (!el || !q) { render({ force: true }); return; }
  el.outerHTML = rowHtml(f, u, q);
  const st = unitStats(f, u), c = $('#uCount'), res = $('#uRes'), sc = document.getElementById('sc' + q.sec.i);
  if (c) { c.textContent = unitCount(st); c.className = st.total && st.answered >= st.total ? 'okc' : ''; }
  if (res) res.innerHTML = unitResLine(st);
  if (sc) sc.outerHTML = secCount(f, u, q.sec);
}

function tapAnswer(f, u, qid, val) {
  if (!S.editor || !QL().byId[qid]) return;
  const key = akey(f, u, qid), now = Date.now();
  if (S.tap && S.tap.key === key && S.tap.val === val && now - S.tap.t < 650) return;      // a double tap must not undo the first tap
  S.tap = { key, val, t: now };
  const row = ansRow(f, u, qid), next = row && row.answer === val ? null : val;
  queue('a', f, u, qid, { answer: next });
  if (next) {                                              // first answer in a unit: fill in the date, and the inspector's name if this phone knows it
    const ur = unitRow(f, u), p = {};
    if (!ur.inspected_on) p.inspected_on = todayISO();
    if (!ur.inspected_by) { const name = store.get('dq_name', ''); if (name) p.inspected_by = name; }
    if (Object.keys(p).length) {
      queue('u', f, u, 0, p);
      Object.keys(p).forEach(k => { const el = view.querySelector('[data-uf="' + k + '"]'); if (el && document.activeElement !== el) el.value = p[k]; });
    }
  }
  refreshRow(f, u, qid);
  flush();
}

function saveUnitField(el, f, u) {
  const k = el.dataset.uf, v = DATE_FIELDS[k] ? (el.value || null) : el.value.trim(), cur = unitRow(f, u)[k];
  if (v === (DATE_FIELDS[k] ? (cur || null) : (cur || ''))) return;
  const p = {}; p[k] = v;
  queue('u', f, u, 0, p);
  if (k === 'inspected_by' && v) store.set('dq_name', v);
  savedToast();
  flush();
}

function savedToast() { toast(S.netDown || navigator.onLine === false ? 'Saved on this phone. It uploads when you have signal.' : '✓ Saved', S.netDown ? 3600 : 1600); }

// ---------------------------------------------------------------- deficiency details (editors)
VIEWS.detail = r => {
  const f = r.floor, u = r.unit, q = QL().byId[r.q], row = ansRow(f, u, r.q) || BLANK_A;
  const isDef = !!q && resultOf(row.answer, q.pa) === 'def';
  const back = S.detailBack === '#/f/' + f + '/punch' ? [S.detailBack, 'Punch list'] : ['#/f/' + f + '/u/' + u + '/q/' + r.q, 'Unit ' + u];
  let h = '<div class="srow"><a class="bk" href="' + back[0] + '">' + BACK + back[1] + '</a><span id="dStatus">' + (isDef ? defPill(defStatus(row)) : '') + '</span></div>' + pendingNote();
  if (!isDef) return h + '<div class="empty">This item isn’t marked as a deficiency any more.</div>';
  h += '<div class="qsec">' + esc(q.section) + ' · Item ' + q.n + '</div><div class="qq">' + esc(q.question) + '</div>' +
    '<div class="mt">Floor ' + f + ' · Unit ' + u + ' · Answer: ' + (row.answer === 'Y' ? 'Yes' : 'No') + '</div>';
  h += '<label class="lab" for="dfNotes">Notes / deficiency</label><textarea class="inp ta" id="dfNotes" data-df="notes" maxlength="2000" placeholder="What is wrong, and where">' + esc(row.notes) + '</textarea>';
  h += '<div class="lab">Photos</div><div class="pgrid" id="phBox">' + photoTiles(f, u, r.q) + '</div>';
  h += '<label class="lab" for="dfFix">Corrective action</label><textarea class="inp ta" id="dfFix" data-df="corrective_action" maxlength="2000" placeholder="What has to be done to fix it" style="min-height:66px">' + esc(row.corrective_action) + '</textarea>';
  h += '<label class="lab" for="dfResp">Responsible</label><input class="inp" id="dfResp" data-df="responsible" maxlength="200" autocomplete="off" placeholder="Who will fix it" value="' + esc(row.responsible) + '">';
  h += '<label class="lab" for="dfDue">Due date</label><div class="row2"><input type="date" class="inp" id="dfDue" data-df="due_date" value="' + esc(row.due_date || '') + '">' +
    '<button type="button" class="mini" data-act="setdate" data-k="due_date" data-v="">Clear</button></div>';
  h += '<div class="sec2" style="margin-top:30px">Correction</div>';
  h += '<label class="lab" for="dfCor">Corrected on</label><div class="row2"><input type="date" class="inp" id="dfCor" data-df="corrected_on" value="' + esc(row.corrected_on || '') + '">' +
    '<button type="button" class="mini" data-act="setdate" data-k="corrected_on" data-v="today">Today</button><button type="button" class="mini" data-act="setdate" data-k="corrected_on" data-v="">Clear</button></div>';
  h += '<label class="lab" for="dfVer">Verified by</label><input class="inp" id="dfVer" data-df="verified_by" maxlength="200" autocomplete="off" placeholder="Who checked the fix" value="' + esc(row.verified_by) + '">';
  h += '<div class="fnote">Changes save by themselves. A deficiency is Closed once “Corrected on” has a date, and Overdue once its due date has passed.</div>';
  h += '<div class="actions"><a class="btn" href="' + back[0] + '">Done</a></div>';
  return h;
};

function saveDetailField(k, value, r) {
  const q = QL().byId[r.q], row = ansRow(r.floor, r.unit, r.q) || BLANK_A;
  if (!q || resultOf(row.answer, q.pa) !== 'def') return;
  const v = DATE_FIELDS[k] ? (value || null) : value.trim();
  if (v === (DATE_FIELDS[k] ? (row[k] || null) : (row[k] || ''))) return;
  const p = {}; p[k] = v;
  queue('a', r.floor, r.unit, r.q, p);
  const ds = $('#dStatus');
  if (ds) ds.innerHTML = defPill(defStatus(ansRow(r.floor, r.unit, r.q)));
  savedToast();
  flush();
}

// ---------------------------------------------------------------- photos of a deficiency
const CAM_SVG = '<svg width="30" height="24" viewBox="0 0 38 30" aria-hidden="true"><path d="M4 7h7l3-4h10l3 4h7a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="17" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const thumbOf = path => path.replace(/\.jpg$/, '_t.jpg');
const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

let phCache = null;
// the photos of one deficiency: saved ones first (oldest first), then the ones still waiting to upload
function photosOf(f, u, qid) {
  if (!phCache || phCache.rev !== S.rev) {
    const by = {};
    Object.keys(S.photos).forEach(id => { const p = S.photos[id], k = akey(p.floor, p.unit, p.question_id); (by[k] = by[k] || []).push(p); });
    Object.keys(by).forEach(k => by[k].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1)));
    phCache = { rev: S.rev, by };
  }
  const saved = phCache.by[akey(f, u, qid)] || [], have = {};
  saved.forEach(p => { have[p.path] = 1; });
  const waiting = Object.keys(S.pend).map(id => S.pend[id]).filter(p => p.f === f && p.u === u && p.q === qid && !have[p.path]);
  return saved.map(p => ({ id: p.id, src: S.blob[p.path] || sb.publicUrl(thumbOf(p.path)), full: sb.publicUrl(p.path) }))
    .concat(waiting.map(p => ({ id: p.id, src: p.url, pending: p.state })));
}

// small strip under a deficiency on the unit page and the punch list
function photoStrip(f, u, qid) {
  const list = photosOf(f, u, qid);
  if (!list.length) return '';
  return '<span class="dp">' + list.slice(0, 4).map(p => '<img crossorigin="anonymous" src="' + esc(p.src) + '" alt="Photo of the problem" loading="lazy"' + (p.pending ? '' : ' data-ph="' + esc(p.id) + '" data-full="' + esc(p.full) + '"') + '>').join('') +
    (list.length > 4 ? '<span class="dpm">+' + (list.length - 4) + '</span>' : '') + '</span>';
}

// the tiles on the details page
function photoTiles(f, u, qid) {
  const list = photosOf(f, u, qid);
  let h = list.map(p => '<button type="button" class="ptile" data-act="viewph" data-id="' + esc(p.id) + '"><img crossorigin="anonymous" src="' + esc(p.src) + '" alt="Photo of the problem"' + (p.full ? ' data-full="' + esc(p.full) + '"' : '') + '>' +
    (p.pending ? '<span class="badge">' + (p.pending === 'queued' ? 'Waiting for signal' : 'Uploading…') + '</span>' : '') + '</button>').join('');
  if (list.length < PHOTO_MAX) h += '<button type="button" class="ptile add" data-act="addph">' + CAM_SVG + '<span>Add photo</span></button>';
  return h;
}
// redraw just the photo tiles (works even while a text box has the cursor)
function refreshPhotos() {
  const r = curRoute, b = $('#phBox');
  if (b && r.view === 'detail') b.innerHTML = photoTiles(r.floor, r.unit, r.q);
}
// a thumbnail that fails to load falls back to the full-size photo
view.addEventListener('error', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.dataset.full && !t.dataset.fb) { t.dataset.fb = '1'; t.src = t.dataset.full; }
}, true);

function viewPhoto(id) {
  const p = S.photos[id];
  if (!p) return;
  const q = QL().byId[p.question_id];
  openSheet('<div class="pv-wrap"><img crossorigin="anonymous" src="' + esc(sb.publicUrl(p.path)) + '" alt="Photo of the problem"></div>' +
    '<div class="pv-meta">Floor ' + p.floor + ' · Unit ' + p.unit + (q ? ' · Item ' + q.n : '') + (p.taken ? '<br>taken ' + esc(fmtStamp(new Date(p.taken))) : '') + '</div>' +
    (S.editor ? '<button type="button" class="sh-btn danger" id="phDel">Delete photo</button>' : '') + '<button type="button" class="sh-btn cancel" id="phCls">Close</button>', (el, close) => {
    $('#phCls', el).onclick = close;
    if (S.editor) $('#phDel', el).onclick = () => { close(); deletePhoto(id); };
  });
}

async function deletePhoto(id) {
  const p = S.photos[id];
  if (!p) return;
  const ok = await choose('Delete this photo?', [{ label: 'Delete photo', value: true, style: 'danger' }]);
  if (!ok) return;
  busy('Deleting…');
  try {
    mustChange(await sb.remove('roughin_photos', 'id=eq.' + encodeURIComponent(id)));
    delete S.photos[id]; applied();
    sb.removeFiles([p.path, thumbOf(p.path)]).catch(() => {});
    busy(false);
    render(); refreshPhotos();
    toast('Photo deleted');
  } catch (e) {
    busy(false);
    toast(isNetworkError(e) ? 'No signal. Try again when you have signal.' : saveErrorText(e).replace('save', 'delete'), 4200);
  }
}

// a photo that has not uploaded yet: say so, and let the editor take it back
async function pendingPhoto(id) {
  const p = S.pend[id];
  if (!p) return;
  if (p.state !== 'queued') { toast('This photo is uploading…'); return; }
  const ok = await choose('This photo is saved on this phone. It uploads when you have signal.', [{ label: 'Remove photo', value: true, style: 'danger' }]);
  if (!ok || !S.pend[id] || S.pend[id].state !== 'queued') return;
  delete MEM[id];
  await Queue.del(id).catch(() => {});
  dropPending(id);
  render(); refreshPhotos();
}

async function addPhoto(r) {
  const how = await choose('Add a photo of the problem', [{ label: 'Take Photo', value: 'cam' }, { label: 'Choose from Photos', value: 'lib' }]);
  if (!how) return;
  const inp = $(how === 'cam' ? '#camIn' : '#libIn');
  inp.value = '';
  inp.onchange = () => { const files = Array.prototype.slice.call(inp.files || []); if (files.length) handleFiles(r.floor, r.unit, r.q, files, how); };
  inp.click();
}

function parseExifDate(buf) {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 12 || v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
        const t = off + 10, le = v.getUint16(t) === 0x4949;
        const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
        const entries = o => { const n = u16(o), m = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; m[u16(e)] = e; } return m; };
        const ascii = e => { const cnt = u32(e + 4), at = cnt > 4 ? u32(e + 8) : e + 8; let s = ''; for (let i = 0; i < cnt; i++) { const c = v.getUint8(t + at + i); if (!c) break; s += String.fromCharCode(c); } return s; };
        const ifd0 = entries(u32(4));
        let s = null;
        if (ifd0[0x8769]) {
          const ex = entries(u32(ifd0[0x8769] + 8));
          if (ex[0x9003]) s = ascii(ex[0x9003]); else if (ex[0x9004]) s = ascii(ex[0x9004]);
        }
        if (!s && ifd0[0x0132]) s = ascii(ifd0[0x0132]);
        const m = s && s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (!m || m[1] === '0000') return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      }
      if (marker === 0xFFDA || (marker & 0xFF00) !== 0xFF00) break;
      off += 2 + len;
    }
  } catch (e) { /* no usable date */ }
  return null;
}

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error('That photo couldn’t be opened.'); }
  return { img, done: () => URL.revokeObjectURL(url) };
}

const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Couldn’t save the photo.'))), type, q));

// Shrink the photo (the whole frame is kept) and burn in the date, time, address, floor and unit.
async function stampPhoto(img, date, f, u) {
  const sw = img.naturalWidth, sh = img.naturalHeight, s = Math.min(1, 1600 / Math.max(sw, sh));
  const W = Math.max(1, Math.round(sw * s)), H = Math.max(1, Math.round(sh * s));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, W, H);
  const fs = Math.max(14, Math.round(Math.min(W, H) * 0.042)), pad = Math.round(fs * 0.85), gh = Math.min(H, Math.round(fs * 4.8));
  const g = x.createLinearGradient(0, H - gh, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
  x.fillStyle = g; x.fillRect(0, H - gh, W, gh);
  x.font = '600 ' + fs + 'px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
  x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = Math.max(2, Math.round(fs / 8)); x.shadowOffsetY = 2;
  x.fillText(fmtStamp(date), pad, H - pad - Math.round(fs * 1.35), W - 2 * pad);
  x.fillText([S.project.project_location, 'Floor ' + f, 'Unit ' + u].filter(Boolean).join(' · '), pad, H - pad, W - 2 * pad);
  const main = await toBlob(c, 'image/jpeg', 0.8);
  const ts = Math.min(1, 400 / Math.max(W, H)), t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(W * ts)); t.height = Math.max(1, Math.round(H * ts));
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  const thumb = await toBlob(t, 'image/jpeg', 0.72);
  return { main, thumb };
}

function askDate(fallback) {
  return new Promise(res => {
    openSheet('<div class="sh-title">This photo doesn’t have its date saved. When was it taken?</div>' +
      '<input type="datetime-local" class="dt" id="dt" value="' + localInput(fallback) + '">' +
      '<button type="button" class="sh-btn strong" id="ok">Use this date</button><button type="button" class="sh-btn cancel" id="no">Cancel</button>', (el, close) => {
      $('#ok', el).onclick = () => { const v = $('#dt', el).value, d = v ? new Date(v) : fallback; close(); res(isNaN(d) ? fallback : d); };
      $('#no', el).onclick = () => { close(); res(null); };
      $('#sheetWrap .dim').onclick = () => { close(); res(null); };
    });
  });
}

async function handleFiles(f, u, qid, files, how) {
  const room = PHOTO_MAX - photosOf(f, u, qid).length;
  if (files.length > room) { files = files.slice(0, Math.max(0, room)); toast('A problem can have up to ' + PHOTO_MAX + ' photos.', 3600); }
  for (const file of files) {
    let date = null;
    try { date = parseExifDate(await file.slice(0, 256 * 1024).arrayBuffer()); } catch (e) { date = null; }
    if (how === 'cam') date = date || new Date();
    else if (!date) { date = await askDate(new Date(file.lastModified || Date.now())); if (!date) continue; }
    busy('Preparing photo…');
    let out;
    try {
      const { img, done } = await loadImage(file);
      out = await stampPhoto(img, date, f, u);
      done();
    } catch (e) { busy(false); toast(e.message || 'That photo couldn’t be opened.', 3600); continue; }
    busy(false);
    const id = newId();
    const rec = { id, f, u, q: qid, path: 'f' + f + '/u' + u + '/q' + qid + '/' + Date.now() + '-' + id.replace(/[^a-z0-9]/gi, '').slice(0, 8) + '.jpg', taken: date.toISOString(), main: out.main, thumb: out.thumb };
    MEM[id] = rec;
    setPending(rec, 'uploading');
    await Queue.put(rec).catch(() => {});                 // kept on the phone until it is safely uploaded
    render(); refreshPhotos();
  }
  flushPhotos();
}

function setPending(rec, state) {
  const old = S.pend[rec.id];
  S.pend[rec.id] = { id: rec.id, f: rec.f, u: rec.u, q: rec.q, path: rec.path, url: old ? old.url : URL.createObjectURL(rec.thumb), state };
  bump();
}
function dropPending(id) {
  const p = S.pend[id];
  if (!p) return;
  URL.revokeObjectURL(p.url);
  delete S.pend[id];
  bump();
}

async function uploadRec(rec) {
  await sb.upload(rec.path, rec.main, 'image/jpeg');
  await sb.upload(thumbOf(rec.path), rec.thumb, 'image/jpeg');
  const rows = await sb.rest('POST', 'roughin_photos?on_conflict=path', [{ floor: rec.f, unit: rec.u, question_id: rec.q, path: rec.path, taken_at: rec.taken }], 'resolution=ignore-duplicates,return=representation');
  if (rows && rows[0]) putPhoto(rows[0]); else scheduleRefresh();          // already recorded by an earlier try
  applied();
}

// photos waiting for signal, kept on the phone (IndexedDB)
const Queue = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('donato-roughin', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('photos', mode), st = t.objectStore('photos'), req = fn(st);
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  put(rec) { return this.tx('readwrite', st => st.put(rec)); },
  del(id) { return this.tx('readwrite', st => st.delete(id)); },
  all() { return this.tx('readonly', st => st.getAll()); }
};

const MEM = {};                                           // this session's photos, in case the phone's storage can't be used
let photoBusy = false, photoAgain = false;
async function flushPhotos() {
  if (photoBusy) { photoAgain = true; return; }
  if (!S.editor || !sb.session) return;
  photoBusy = true;
  let lost = false;
  try {
    let recs = [];
    try { recs = (await Queue.all()) || []; } catch (e) { recs = []; }
    Object.keys(MEM).forEach(id => { if (!recs.some(r => r.id === id)) recs.push(MEM[id]); });
    for (const rec of recs) {
      if (!S.pend[rec.id]) continue;                       // taken back while waiting
      setPending(rec, 'uploading'); refreshPhotos(); scheduleRender();
      try {
        await uploadRec(rec);
        const pn = S.pend[rec.id];
        if (pn) { S.blob[rec.path] = pn.url; delete S.pend[rec.id]; bump(); }      // keep showing the copy we already have
        delete MEM[rec.id];
        await Queue.del(rec.id).catch(() => {});
        setNet(true);
      } catch (e) {
        if (isNetworkError(e)) {
          setPending(rec, 'queued'); setNet(false);
          toast('No signal. The photo is saved on this phone and uploads when you have signal.', 4200);
          break;
        }
        if (e.status === 401 || e.status === 403 || e.code === '42501') { setPending(rec, 'queued'); lost = true; break; }
        const gone = e.code === '23503';                   // its question was deleted from the checklist in the meantime
        delete MEM[rec.id];
        await Queue.del(rec.id).catch(() => {});
        dropPending(rec.id);
        if (gone) sb.removeFiles([rec.path, thumbOf(rec.path)]).catch(() => {});
        toast(gone ? 'A photo wasn’t uploaded because its question was deleted from the checklist.' : 'A photo couldn’t be uploaded: ' + e.message, 4200);
      }
    }
  } catch (e) { /* the phone’s storage is unavailable */ }
  photoBusy = false;
  refreshPhotos(); scheduleRender();
  if (lost) { await lostAccess(); return; }
  if (photoAgain) { photoAgain = false; flushPhotos(); }
}

// when the app opens: show the photos that were still waiting, then try to send them
async function restorePhotos() {
  try { (await Queue.all()).forEach(rec => setPending(rec, 'queued')); } catch (e) { /* no storage */ }
  refreshPhotos(); scheduleRender();
  flushPhotos();
}

// ---------------------------------------------------------------- punch list
VIEWS.punch = r => {
  const fl = floorOf(r.floor), f = fl.floor, ql = QL(), all = floorDefs(fl);
  const nOpen = all.filter(d => d.st !== 'closed').length, nOver = all.filter(d => d.st === 'overdue').length, nClosed = all.length - nOpen;
  const shown = all.filter(d => S.pf === 'all' || (S.pf === 'closed') === (d.st === 'closed'));
  let h = '<div class="srow"><a class="bk" href="#/f/' + f + '">' + BACK + 'Floor ' + f + '</a><span>' + nOpen + ' open' + (nOver ? ' · <span class="red">' + nOver + ' overdue</span>' : '') + '</span></div>' + pendingNote();
  h += '<div class="chips">' + [['open', 'Open', nOpen], ['closed', 'Closed', nClosed], ['all', 'All', all.length]].map(c =>
    '<button type="button" class="chip' + (S.pf === c[0] ? ' on' : '') + '" data-act="filter" data-v="' + c[0] + '" aria-pressed="' + (S.pf === c[0]) + '">' + c[1] + ' ' + c[2] + '</button>').join('') + '</div>';
  if (!shown.length) {
    h += '<div class="empty" style="padding:34px 10px">' + (!all.length ? 'No deficiencies on Floor ' + f + '.' : S.pf === 'open' ? 'No open deficiencies on Floor ' + f + '. ✓' : 'No closed deficiencies on Floor ' + f + ' yet.') + '</div>';
  }
  let unit = 0;
  shown.forEach(d => {
    if (d.u !== unit) { unit = d.u; h += '<div class="pu"><span>UNIT ' + unit + '</span><a href="#/f/' + f + '/u/' + unit + '">Open unit ›</a></div>'; }
    h += '<a class="pc ' + d.st + '" href="#/f/' + f + '/u/' + d.u + '/' + (S.editor ? 'd' : 'q') + '/' + d.q.id + '"><span class="pt"><span>U' + two(d.u) + '-' + two(d.q.n) + ' · ' + esc(d.q.section) + '</span>' + defPill(d.st) + '</span>' +
      '<span class="pq">' + esc(d.q.question) + '</span>' + defDetails(d.r) + photoStrip(f, d.u, d.q.id) + '</a>';
  });
  if (all.length) {
    const by = {};
    all.forEach(d => { const b = by[d.q.section] || (by[d.q.section] = [0, 0]); b[0]++; if (d.st !== 'closed') b[1]++; });
    h += '<div class="sec2" style="margin-bottom:2px">Deficiencies by section</div><table class="bs">' +
      ql.secs.map(s => { const b = by[s.name] || [0, 0]; return '<tr><td>' + esc(s.name) + '</td><td class="n">' + b[0] + ' total</td><td class="n">' + (b[1] ? '<span class="red">' + b[1] + ' open</span>' : '0 open') + '</td></tr>'; }).join('') +
      '<tr class="tot"><td>All sections</td><td class="n">' + all.length + ' total</td><td class="n">' + nOpen + ' open</td></tr></table>';
  }
  return h;
};

// ---------------------------------------------------------------- checklist questions (editors only)
const paChip = pa => pa === 'N' ? '<span class="pa n">Problem: N</span>' : pa === 'Y' ? '<span class="pa y">Problem: Y</span>' : '<span class="pa x">Info only</span>';

VIEWS.questions = () => {
  const ql = QL();
  let h = '<div class="srow"><a class="bk" href="#/">' + BACK + 'All floors</a><span>' + plural(ql.list.length, 'question', 'questions') + '</span></div>';
  h += '<div class="hint" style="margin-bottom:12px">This checklist is used for every unit on every floor, and changes show up everywhere right away. Tap a question to edit it, move it, remove it or change its problem answer.</div>';
  h += '<button type="button" class="btn" data-act="addq" data-s="">Add a question</button>';
  ql.secs.forEach(sec => {
    if (S.ren && S.ren.name === sec.name) {
      h += '<div class="ren"><input class="inp" id="renIn" data-ren="1" maxlength="80" value="' + esc(S.ren.value) + '" aria-label="Section name">' +
        '<button type="button" class="mini" data-act="rensave">Save</button><button type="button" class="mini" data-act="rencancel">Cancel</button></div>';
    } else h += '<div class="sec2">' + esc(sec.name) + '<button type="button" class="link" data-act="ren" data-s="' + sec.i + '">Rename</button></div>';
    sec.items.forEach(q => {
      h += '<button type="button" class="qm" id="qm' + q.id + '" data-act="editq" data-id="' + q.id + '"><span class="qn">' + q.n + '.</span><span class="qt">' + esc(q.question) + '</span>' + paChip(q.pa) + '</button>';
    });
    h += '<button type="button" class="addq" data-act="addq" data-s="' + sec.i + '">+ Add a question to this section</button>';
  });
  if (!ql.list.length) h += '<div class="empty" style="padding:34px 10px">No questions yet. Add the first one.</div>';
  if (ql.removed.length) {
    h += '<div class="sec2">Removed<span>' + ql.removed.length + '</span></div>';
    ql.removed.forEach(q => {
      h += '<div class="rm"><div class="qt">' + esc(q.question) + '<div class="mt" style="margin-top:3px">' + esc(q.section) + '</div></div><div class="rb">' +
        '<button type="button" class="link" data-act="putback" data-id="' + q.id + '">Put back</button><button type="button" class="link del" data-act="delq" data-id="' + q.id + '">Delete forever</button></div></div>';
    });
  }
  return h;
};

// what is being typed on the add / edit page, kept here so a redraw never loses it
function ensureDraft(r) {
  if (S.draft && S.draft.h === location.hash) return S.draft;
  const ql = QL();
  if (r.view === 'qedit') {
    const q = S.q[r.id];
    S.draft = q && !q.removed ? { h: location.hash, id: q.id, question: q.question, section: q.section, newSection: '', pa: q.problem_answer } : null;
  } else {
    const sec = S.newSec != null && ql.secs[S.newSec] ? ql.secs[S.newSec].name : ql.secs.length ? ql.secs[0].name : NEW_SECTION;
    S.draft = { h: location.hash, id: null, question: '', section: sec, newSection: '', pa: 'N' };
  }
  return S.draft;
}

function qform(r) {
  const d = ensureDraft(r), ql = QL(), isNew = r.view === 'qnew', it = d && d.id != null ? ql.byId[d.id] : null;
  let h = '<div class="srow"><a class="bk" href="#/questions">' + BACK + 'Questions</a><span id="qfPos">' + (isNew ? 'New question' : it ? 'Question ' + it.n + ' of ' + ql.list.length : '') + '</span></div>';
  if (!d || (!isNew && !it)) return h + '<div class="empty">This question isn’t on the checklist any more.</div>';
  if (d.section !== NEW_SECTION && !ql.secs.some(s => s.name === d.section)) { d.newSection = d.section; d.section = NEW_SECTION; }
  h += '<label class="lab" for="qfText" style="margin-top:4px">Question</label><textarea class="inp ta" id="qfText" data-qf="question" maxlength="500" placeholder="Write it as a yes or no question">' + esc(d.question) + '</textarea>';
  h += '<label class="lab" for="qfSec">Section</label><select class="inp" id="qfSec" data-qf="section">' +
    ql.secs.map(s => '<option value="' + esc(s.name) + '"' + (d.section === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') +
    '<option value="' + NEW_SECTION + '"' + (d.section === NEW_SECTION ? ' selected' : '') + '>New section…</option></select>';
  h += '<input class="inp" id="qfNew" data-qf="newSection" maxlength="80" autocomplete="off" placeholder="Name of the new section" aria-label="Name of the new section" value="' + esc(d.newSection) + '" style="margin-top:8px' + (d.section === NEW_SECTION ? '' : ';display:none') + '">';
  h += '<div class="lab">Which answer is the problem?</div>' + [
    ['N', 'No', 'A “No” answer is flagged as a deficiency. Most questions work this way.'],
    ['Y', 'Yes', 'A “Yes” answer is flagged. For questions that ask about a problem, like “…obstructed?”'],
    ['None', 'Neither', 'Information only. No answer is ever flagged.']
  ].map(o => '<button type="button" class="opt' + (d.pa === o[0] ? ' on' : '') + '" data-act="opt" data-v="' + o[0] + '" aria-pressed="' + (d.pa === o[0]) + '"><i></i><span><b>' + o[1] + '</b>' + o[2] + '</span></button>').join('');
  h += '<div class="ferr" id="qfErr"></div><div class="actions" style="margin-top:4px"><button type="button" class="btn" data-act="saveq">' + (isNew ? 'Add question' : 'Save changes') + '</button>';
  if (!isNew) {
    const i = it.sec.items.indexOf(it);
    h += '<div class="row2"><button type="button" class="btn alt" data-act="moveq" data-v="-1"' + (i <= 0 ? ' disabled' : '') + '>Move up</button>' +
      '<button type="button" class="btn alt" data-act="moveq" data-v="1"' + (i >= it.sec.items.length - 1 ? ' disabled' : '') + '>Move down</button></div>' +
      '<button type="button" class="btn danger" data-act="removeq">Remove question</button>';
  }
  return h + '<a class="btn alt" href="#/questions">Cancel</a></div>';
}
VIEWS.qnew = qform;
VIEWS.qedit = qform;

function nextPosition() {
  let m = 0;
  for (const k in S.q) if (S.q[k].position > m) m = S.q[k].position;
  return Math.floor(m) + 1;
}
// every question, removed ones too, in checklist order
function allByPosition() {
  return Object.keys(S.q).map(k => S.q[k]).sort((a, b) => a.position - b.position || a.id - b.id);
}
// Where a question goes when it joins a section: straight after that section's last question,
// so every section stays in one piece and the sections keep their order. A new section goes last.
function positionIn(section) {
  const sec = QL().secs.find(s => s.name === section);
  if (!sec) return nextPosition();
  const all = allByPosition(), last = sec.items[sec.items.length - 1], nx = all[all.findIndex(q => q.id === last.id) + 1];
  if (!nx) return last.position + 1;
  const pos = (last.position + nx.position) / 2;
  return pos > last.position && pos < nx.position ? pos : nextPosition();
}

function formError(msg) { const e = $('#qfErr'); if (e) e.textContent = msg; else toast(msg); }

// run one change to the question list; question changes need a connection
async function questionChange(label, work) {
  busy(label);
  try {
    const rows = await work();
    busy(false);
    return rows;
  } catch (e) {
    busy(false);
    const msg = saveErrorText(e);
    if ($('#qfErr')) formError(msg); else toast(msg, 4200);
    return null;
  }
}
function takeQuestions(rows) { (rows || []).forEach(putQuestion); applied(); }
function mustChange(rows) {
  if (!rows || !rows.length) throw new SupaError('nothing was changed. The question may be gone, or your email isn’t on the editor list.', 409);
  return rows;
}

async function saveQuestion() {
  const d = S.draft;
  if (!d) return;
  const text = oneLine(d.question);
  let section = d.section === NEW_SECTION ? oneLine(d.newSection) : d.section;
  if (!text) { formError('Type the question first.'); return; }
  if (!section) { formError('Give the new section a name.'); return; }
  const same = QL().secs.find(s => s.name.toLowerCase() === section.toLowerCase());
  if (same) section = same.name;                                   // same section, typed with different capitals
  formError('');
  let id = d.id;
  if (id == null) {
    const rows = await questionChange('Adding…', async () => mustChange(await sb.insert('roughin_questions', [{ section, question: text, problem_answer: d.pa, position: positionIn(section) }])));
    if (!rows) return;
    takeQuestions(rows); id = rows[0].id;
  } else {
    const q = S.q[id], patch = {};
    if (!q) { formError('This question isn’t on the checklist any more.'); return; }
    if (text !== q.question) patch.question = text;
    if (d.pa !== q.problem_answer) patch.problem_answer = d.pa;
    if (section !== q.section) { patch.section = section; patch.position = positionIn(section); }      // goes to the end of its new section
    if (Object.keys(patch).length) {
      const rows = await questionChange('Saving…', async () => mustChange(await sb.update('roughin_questions', 'id=eq.' + id, patch)));
      if (!rows) return;
      takeQuestions(rows);
    }
  }
  S.flashQ = id; S.draft = null;
  toast(d.id == null ? '✓ Question added' : '✓ Saved');
  location.hash = '#/questions';
}

// Swap a question with its neighbour in the same section. One of the two is given a position just past the other,
// between that one and whatever comes next in the whole checklist, so no other question and no section changes place.
async function moveQuestion(dir) {
  const d = S.draft, it = d && QL().byId[d.id];
  if (!it) return;
  const items = it.sec.items, other = items[items.indexOf(it) + dir];
  if (!other) return;
  const first = dir < 0 ? other : it, second = dir < 0 ? it : other;      // the order they are in now
  const all = allByPosition(), at = q => all.findIndex(x => x.id === q.id);
  const before = all[at(first) - 1], after = all[at(second) + 1];
  const up = { id: second.id, lo: before ? before.position : first.position - 2, hi: first.position };       // the lower one goes just above the upper one
  const down = { id: first.id, lo: second.position, hi: after ? after.position : second.position + 2 };      // or the upper one goes just below the lower one
  const gu = up.hi - up.lo, gd = down.hi - down.lo;
  const apart = first === items[0] && at(second) - at(first) > 1;         // other sections' questions sit between the two: moving the section's first one down would move the whole section
  const pick = apart || gu > gd || (gu === gd && dir < 0) ? up : down;    // otherwise whichever leaves more room; when equal, move the one being edited
  const pos = (pick.lo + pick.hi) / 2;
  if (!(pos > pick.lo && pos < pick.hi)) { toast('That question couldn’t be moved. Try again in a moment.', 3600); scheduleRefresh(); return; }
  const rows = await questionChange('Moving…', async () => mustChange(await sb.update('roughin_questions', 'id=eq.' + pick.id, { position: pos })));
  if (!rows) return;
  takeQuestions(rows);
  render({ force: true });
}

async function removeQuestion() {
  const d = S.draft, q = d && S.q[d.id];
  if (!q) return;
  const ok = await choose('Remove this question from every unit?', [{ label: 'Remove question', value: true, style: 'danger' }], 'Answers already recorded for it are kept, and you can put it back from the Removed list.');
  if (!ok) return;
  const rows = await questionChange('Removing…', async () => mustChange(await sb.update('roughin_questions', 'id=eq.' + q.id, { removed_at: new Date().toISOString() })));
  if (!rows) return;
  takeQuestions(rows);
  S.draft = null;
  toast('Question removed. It’s in the Removed list at the bottom.', 3600);
  location.hash = '#/questions';
}

async function putBackQuestion(id) {
  const rows = await questionChange('Putting back…', async () => mustChange(await sb.update('roughin_questions', 'id=eq.' + id, { removed_at: null })));
  if (!rows) return;
  takeQuestions(rows);
  render({ force: true });
  scrollToEl('qm' + id);
  toast('✓ Question is back on the checklist');
}

async function deleteQuestion(id) {
  const q = S.q[id];
  if (!q) return;
  const ok = await choose('Delete this question for good?', [{ label: 'Delete forever', value: true, style: 'danger' }], 'The question and every answer recorded for it will be erased. This can’t be undone.');
  if (!ok) return;
  const rows = await questionChange('Deleting…', async () => mustChange(await sb.remove('roughin_questions', 'id=eq.' + id)));
  if (!rows) return;
  delete S.q[id];
  const files = [];
  Object.keys(S.photos).forEach(k => { const p = S.photos[k]; if (p.question_id === id) { files.push(p.path, thumbOf(p.path)); delete S.photos[k]; } });
  if (files.length) sb.removeFiles(files).catch(() => {});
  Object.keys(S.pend).forEach(pid => { if (S.pend[pid].q === id) { delete MEM[pid]; Queue.del(pid).catch(() => {}); dropPending(pid); } });      // photos still waiting to upload
  Object.keys(S.ans).forEach(k => { if (S.ans[k].question_id === id) delete S.ans[k]; });
  Object.keys(S.out).forEach(k => { if (S.out[k].k === 'a' && S.out[k].q === id) delete S.out[k]; });
  saveOut(); applied();
  render({ force: true });
  toast('Question deleted');
}

async function renameSection() {
  const from = S.ren.name, to = oneLine(S.ren.value);
  if (!to) { toast('Type a name for the section.'); return; }
  if (to === from) { S.ren = null; render({ force: true }); return; }
  if (QL().secs.some(s => s.name !== from && s.name.toLowerCase() === to.toLowerCase())) { toast('There’s already a section with that name.', 3600); return; }
  const ids = Object.keys(S.q).filter(k => S.q[k].section === from).map(k => S.q[k].id);
  const rows = await questionChange('Renaming…', async () => mustChange(await sb.update('roughin_questions', 'id=in.(' + ids.join(',') + ')', { section: to })));
  if (!rows) return;
  takeQuestions(rows);
  S.ren = null;
  render({ force: true });
  toast('✓ Section renamed');
}

async function saveProject(el) {
  const v = el.value.trim();
  if (v === S.project.project_location) return;
  try {
    const rows = mustChange(await sb.update('roughin_project', 'id=eq.1', { project_location: v }));
    putProject(rows[0]); applied(); showAddress();
    toast('✓ Saved');
  } catch (e) {
    el.value = S.project.project_location;
    toast(saveErrorText(e), 4200);
  }
}

// ---------------------------------------------------------------- taps and typing
view.addEventListener('click', e => {
  const r = curRoute, t = e.target;
  const ab = t.closest('.ab');
  if (ab) { if (r.view === 'unit') tapAnswer(r.floor, r.unit, +ab.dataset.q, ab.dataset.a); return; }
  const ph = t.closest('[data-ph]');
  if (ph && !t.closest('[data-det]') && !t.closest('a')) { viewPhoto(ph.dataset.ph); return; }       // guests: tap a thumbnail to see it large
  const det = t.closest('[data-det]');
  if (det) { if (r.view === 'unit') location.hash = '#/f/' + r.floor + '/u/' + r.unit + '/d/' + det.dataset.det; return; }
  const b = t.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'retry') { S.failed = false; render(); refresh(); }
  else if (act === 'signout') signOut();
  else if (act === 'filter') { S.pf = b.dataset.v; render({ force: true }); }
  else if (act === 'viewph') { if (S.pend[b.dataset.id]) pendingPhoto(b.dataset.id); else viewPhoto(b.dataset.id); }
  else if (act === 'addph' && r.view === 'detail' && S.editor) addPhoto(r);
  else if (act === 'setdate' && r.view === 'detail') {
    const k = b.dataset.k, v = b.dataset.v === 'today' ? todayISO() : '', inp = view.querySelector('[data-df="' + k + '"]');
    if (inp) inp.value = v;
    saveDetailField(k, v, r);
  }
  else if (!S.editor) return;
  else if (act === 'addq') { S.newSec = b.dataset.s === '' ? null : +b.dataset.s; S.draft = null; location.hash = '#/questions/new'; }
  else if (act === 'editq') location.hash = '#/questions/e/' + b.dataset.id;
  else if (act === 'ren') { const sec = QL().secs[+b.dataset.s]; if (sec) { S.ren = { name: sec.name, value: sec.name }; render({ force: true }); const i = $('#renIn'); if (i) i.focus(); } }
  else if (act === 'rencancel') { S.ren = null; render({ force: true }); }
  else if (act === 'rensave') renameSection();
  else if (act === 'putback') putBackQuestion(+b.dataset.id);
  else if (act === 'delq') deleteQuestion(+b.dataset.id);
  else if (act === 'opt' && S.draft) { S.draft.pa = b.dataset.v; view.querySelectorAll('.opt').forEach(o => { const on = o === b; o.classList.toggle('on', on); o.setAttribute('aria-pressed', on); }); }
  else if (act === 'saveq') saveQuestion();
  else if (act === 'moveq') moveQuestion(+b.dataset.v);
  else if (act === 'removeq') removeQuestion();
});

// typing on the add / edit question page and in the rename box goes straight into the draft
function draftInput(el) {
  if (el.dataset.qf && S.draft) {
    const was = S.draft[el.dataset.qf];
    S.draft[el.dataset.qf] = el.value;
    if (el.dataset.qf === 'section' && was !== el.value) {
      const n = $('#qfNew');
      if (n) { n.style.display = el.value === NEW_SECTION ? 'block' : 'none'; if (el.value === NEW_SECTION) n.focus(); }
    }
  } else if (el.dataset.ren && S.ren) S.ren.value = el.value;
}

view.addEventListener('change', e => {
  const r = curRoute, el = e.target;
  if (!S.editor) return;
  if (el.dataset.pf) saveProject(el);
  else if (el.dataset.uf && r.view === 'unit') saveUnitField(el, r.floor, r.unit);
  else if (el.dataset.df && r.view === 'detail') saveDetailField(el.dataset.df, el.value, r);
  else draftInput(el);
});

view.addEventListener('input', e => draftInput(e.target));

view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.ren) { e.preventDefault(); renameSection(); }
});

async function signOut() {
  const n = pendingCount();
  if (n) {
    const ok = await choose(plural(n, 'change hasn’t', 'changes haven’t') + ' uploaded yet.', [{ label: 'Sign out anyway', value: true, style: 'danger' }],
      (n === 1 ? 'It stays on this phone and uploads' : 'They stay on this phone and upload') + ' the next time an editor signs in here.');
    if (!ok) return;
  }
  await sb.signOut();
  S.editor = false; store.del('dq_ed');
  await exitToStart();
}

// ---------------------------------------------------------------- start screen
const live = new Live(sb, 'qaqc-roughin', ['roughin_questions', 'roughin_answers', 'roughin_units', 'roughin_project', 'roughin_photos'], onLiveChange, up => {
  S.live = up;
  const l = $('.live');
  if (l) { l.classList.toggle('up', up); l.lastChild.textContent = up ? 'Live' : 'Connecting'; }
  if (up) checkVersion();                               // catch up on anything missed while disconnected
});
const EASE = 'cubic-bezier(.65,0,.35,1)';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const box = el => el.getBoundingClientRect();
const brandPairs = () => [[$('.st-lh'), $('header .lh'), 'scale'], [$('.st-dbl'), $('header .dbl'), 'scaleX'], [$('.st-ttl'), $('header .tb .l'), 'scale']];
let startMode = 'in';

function startChoices() {
  const st = $('#start');
  st.classList.remove('form', 'busy');
  $('.st-brand').style.transform = '';
  $('#stErr').textContent = '';
}

function startForm() {
  const st = $('#start');
  startMode = 'in'; drawForm();
  st.classList.add('form');
  requestAnimationFrame(() => {          // lift the logo so it clears the form
    const b = box($('.st-brand .st-flr')), f = box($('#stForm'));
    const lift = Math.max(0, b.bottom + 28 - f.top);
    $('.st-brand').style.transform = lift ? 'translateY(' + (-lift) + 'px)' : '';
  });
}

function drawForm() {
  $('#stFtitle').textContent = startMode === 'in' ? 'Editor sign in' : 'Create your editor password';
  $('#stPw').placeholder = startMode === 'in' ? 'Password' : 'At least 6 characters';
  $('#stPw').autocomplete = startMode === 'in' ? 'current-password' : 'new-password';
  $('#stGo .lbl').textContent = startMode === 'in' ? 'Sign in' : 'Create password';
  $('#stMode').textContent = startMode === 'in' ? 'First time? Create your password' : 'I already have a password';
  $('#stErr').textContent = '';
}

async function submitForm(e) {
  e.preventDefault();
  const em = $('#stEm').value.trim(), pw = $('#stPw').value, err = $('#stErr'), st = $('#start');
  if (st.classList.contains('busy')) return;
  if (!em || !pw) { err.textContent = 'Enter your email and password.'; return; }
  st.classList.add('busy'); err.textContent = ''; $('#stNotice').textContent = '';
  try {
    if (startMode === 'in') await sb.signIn(em, pw);
    else {
      const now = await sb.signUp(em, pw, APP_URL);
      if (!now) { st.classList.remove('busy'); $('#stNotice').textContent = 'We sent a confirmation link to ' + em + '. Tap it, then come back here and sign in.'; startMode = 'in'; drawForm(); return; }
    }
    S.editor = (await sb.rpc('is_editor')) === true;
    if (!S.editor) { await sb.signOut(); st.classList.remove('busy'); err.textContent = 'This email isn’t on the editor list.'; return; }
    store.set('dq_ed', sb.email);
    $('#stPw').value = '';
    S.guest = false;
    await enterApp();
    toast('✓ Signed in as editor');
    flush(); flushPhotos();
  } catch (ex) {
    if (sb.session) await sb.signOut();
    S.editor = false;
    st.classList.remove('busy');
    err.textContent = /invalid login/i.test(ex.message) ? 'Wrong email or password.' : /not confirmed/i.test(ex.message) ? 'Confirm your email first: tap the link we sent you.' : isNetworkError(ex) ? 'No signal. Try again when you have signal.' : ex.message;
  }
}

// Slide from the start screen into the app: the letterhead, rule and title glide into the header,
// then the page content rises in.
async function enterApp() {
  const st = $('#start');
  if (!st.classList.contains('on')) { render({ force: true }); return; }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  window.scrollTo(0, 0);
  render({ force: true });
  const D = reduceMotion() ? 0 : 640;
  st.classList.add('leaving');
  const anims = brandPairs().map(([src, dst, kind]) => {
    const a = box(src), b = box(dst), s = b.width / a.width;
    const to = 'translate(' + (b.left - a.left) + 'px,' + (b.top - a.top) + 'px) ' + (kind === 'scaleX' ? 'scaleX(' + s + ')' : 'scale(' + s + ')');
    return src.animate([{ transform: 'none' }, { transform: to }], { duration: D, delay: D ? 140 : 0, easing: EASE, fill: 'forwards' });
  });
  await Promise.all(anims.map(x => x.finished.catch(() => {})));
  document.body.classList.add('arrive');
  st.classList.add('seen');
  st.classList.remove('on', 'leaving', 'busy');
  anims.forEach(x => x.cancel());
  startChoices();
  setTimeout(() => document.body.classList.remove('arrive'), 1000);
}

// The reverse, after signing out.
async function exitToStart() {
  const st = $('#start');
  if (st.classList.contains('on')) return;
  $('#sheetWrap').classList.remove('on'); $('#sheetWrap').innerHTML = '';
  window.scrollTo(0, 0);
  startChoices();
  st.classList.add('on', 'returning');
  const D = reduceMotion() ? 0 : 600;
  const anims = brandPairs().map(([src, dst, kind]) => {
    const a = box(src), b = box(dst), s = b.width / a.width;
    const from = 'translate(' + (b.left - a.left) + 'px,' + (b.top - a.top) + 'px) ' + (kind === 'scaleX' ? 'scaleX(' + s + ')' : 'scale(' + s + ')');
    return src.animate([{ transform: from }, { transform: 'none' }], { duration: D, easing: EASE, fill: 'backwards' });
  });
  await Promise.all(anims.map(x => x.finished.catch(() => {})));
  st.classList.remove('returning');
  render({ force: true });
}

async function start() {
  const st = $('#start');
  $('.st-flr').textContent = (FLOORS.length === 1 ? 'FLOOR ' : 'FLOORS ') + FLOORS.map(f => f.floor).join(' · ');
  $('#stEditor').onclick = startForm;
  $('#stGuest').onclick = () => { S.guest = true; enterApp(); };
  $('#stAsGuest').onclick = () => { S.guest = true; enterApp(); };
  $('#stMode').onclick = () => { startMode = startMode === 'in' ? 'up' : 'in'; drawForm(); };
  $('#stForm').onsubmit = submitForm;
  $('.st-addr').textContent = DEFAULT_LOCATION;
  loadCache();
  render();
  refresh();
  if (sb.session) {
    st.classList.add('checking');
    await sb.fresh(); await checkEditor();
    if (!S.editor && sb.session) await sb.signOut();
    st.classList.remove('checking');
  }
  if (S.editor) { await sleep(reduceMotion() ? 0 : 650); await enterApp(); }
  live.start();
  flush();
  restorePhotos();
  let ticks = 0;
  setInterval(() => {
    ticks++;
    flush(); flushPhotos();
    if (!S.live || ticks % 10 === 0) checkVersion();                 // every 30 s while not live, every 5 minutes otherwise
    if (S.day !== todayISO()) { S.day = todayISO(); bump(); scheduleRender(); }     // a new day can make a deficiency overdue
  }, 30000);
  window.addEventListener('online', () => { live.kick(); flush(); flushPhotos(); checkVersion(); });
  window.addEventListener('offline', () => scheduleRender());
  window.addEventListener('pagehide', saveCache);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { saveCache(); return; }
    live.kick(); flush(); flushPhotos(); checkVersion();
  });
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!standalone && /iPhone|iPad/.test(navigator.userAgent) && store.get('dq_a2hs', 0) !== 1) {
    const b = $('#a2hs'); b.classList.add('on'); document.body.classList.add('a2hs-on');
    b.querySelector('button').onclick = () => { b.classList.remove('on'); document.body.classList.remove('a2hs-on'); store.set('dq_a2hs', 1); };
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
