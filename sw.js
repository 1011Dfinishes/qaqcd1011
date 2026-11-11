// App files: network first (so updates show up), saved copy when there is no signal.
// Photos: cached after the first view (each photo has its own file name, so they never change).
// The checklist data itself is kept by the app (see app.js), not here.
const SHELL = 'dq-shell-v4', PHOTOS = 'dq-photos-v1';
const FILES = ['./', 'index.html', 'config.js', 'sb.js', 'pdf.js', 'app.js', 'letterhead.png', 'letterhead.jpg', 'icon-180.png', 'icon-192.png', 'manifest.webmanifest'];
const HOME = new URL('./', self.location).pathname;                       // the app's own folder on the site

// A second copy of the app files is kept in the phone's database. The Finishes app lives on the same site
// and clears every cache it does not know each time it updates; without this second copy, this app could
// not open with no signal after that happened.
const wait = ms => new Promise(r => setTimeout(r, ms));
const quietly = p => Promise.race([p.catch(() => undefined), wait(4000)]);   // the second copy must never hold anything up
function shelf() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('donato-roughin-shell', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}
async function keep(path, res) {
  const body = await res.arrayBuffer(), type = res.headers.get('content-type') || '', db = await shelf();
  try {
    await new Promise((ok, no) => {
      const t = db.transaction('files', 'readwrite');
      t.objectStore('files').put({ body, type }, path);
      t.oncomplete = ok; t.onerror = t.onabort = () => no(t.error);
    });
  } finally { db.close(); }
}
async function kept(path) {
  const db = await shelf();
  try {
    const row = await new Promise((ok, no) => {
      const r = db.transaction('files').objectStore('files').get(path);
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
    return row ? new Response(row.body, { headers: { 'Content-Type': row.type } }) : undefined;
  } finally { db.close(); }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(FILES.map(async f => {
      const req = new Request(f, { cache: 'no-cache' }), res = await fetch(req);
      if (!res.ok) throw new Error('could not get ' + f);
      const copy = res.clone(), u = new URL(req.url);
      await c.put(u.origin + u.pathname, res);
      await quietly(keep(u.pathname, copy));
    }));
    await self.skipWaiting();
  })());
});

// Only this app's own old caches are removed (the Finishes app lives on the same site and keeps its own).
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('dq-') === 0 && k !== SHELL && k !== PHOTOS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/storage/v1/object/public/roughin/')) {
    e.respondWith(caches.open(PHOTOS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.indexOf(HOME) !== 0) return;      // the database is never cached here
  const key = url.origin + url.pathname;                                 // one saved copy per file, whatever follows the "?"
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });               // always check GitHub for a newer copy
      if (res.ok) {
        const a = res.clone(), b = res.clone();
        e.waitUntil(Promise.all([caches.open(SHELL).then(c => c.put(key, a)).catch(() => {}), quietly(keep(url.pathname, b))]));
      }
      return res;
    } catch (err) {                                                       // no signal: use the saved copy
      const c = await caches.open(SHELL);
      let hit = (await c.match(key)) || (await quietly(kept(url.pathname)));
      if (!hit && req.mode === 'navigate') hit = (await c.match(self.location.origin + HOME + 'index.html')) || (await quietly(kept(HOME + 'index.html')));
      return hit || Response.error();
    }
  })());
});
