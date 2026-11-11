/* Folio cloud sync.
 *
 * One small JSON file (folio-sync.json) holds book metadata, reading position, bookmarks, highlights and
 * deletion "tombstones". Each device merges that file with its own data and writes it back, so changes
 * made on any device - including removals - reach all the others. Books are matched across devices by the
 * SHA-256 of the file (the book id), so the same book is recognised everywhere.
 *
 * Optionally the book files themselves are mirrored too (books/<id>.<ext>).
 *
 * Merge rules (last writer wins, per record):
 *   books        metadata (title, tags, rating, ...) by updatedAt; reading position/status by posAt; time read = max
 *   highlights   by updatedAt
 *   bookmarks    by updatedAt
 *   deletions    a tombstone beats any record last changed before it
 *
 * Providers: a folder you choose (works with any cloud client that syncs a folder: Drive, OneDrive,
 * Dropbox, iCloud) and Google Drive's private app-data area.
 */
import * as db from './db.js';
import { lsGet, lsSet } from './ui.js';

const DATA = 'folio-sync.json';
const TOMB_TTL = 180 * 864e5;
const cfgKey = 'sw-sync';
export const getCfg = () => {
  const c = { provider: null, connected: false, auto: true, files: false, lastSync: 0, lastError: '', ...lsGet(cfgKey, {}) };
  c.ids = c.ids || {};                                   // OAuth client IDs, per provider
  c.dav = { url: '', user: '', pass: '', ...(c.dav || {}) };  // your own WebDAV server
  c.nc = { server: '', user: '', pass: '', folder: 'Folio', ...(c.nc || {}) }; // Nextcloud
  return c;
};
export const setCfg = (patch) => lsSet(cfgKey, { ...getCfg(), ...patch });

/* ============================================================================== providers */
const extOf = (n) => (n.match(/\.([a-z0-9]+)$/i) || [])[1] || '';

/** A folder on this computer (File System Access API; Chromium desktop). */
export const folderProvider = {
  id: 'folder', label: 'Folder on this computer',
  supported: () => typeof showDirectoryPicker === 'function',
  async handle() { return db.get('kv', 'sync-dir'); },
  async choose() {
    const h = await showDirectoryPicker({ id: 'folio-sync', mode: 'readwrite' });
    await db.put('kv', h, 'sync-dir');
    return h;
  },
  async ready(interactive) {
    const h = await this.handle();
    if (!h) throw new Error('No sync folder chosen.');
    let p = await h.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted' && interactive) p = await h.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') throw Object.assign(new Error('Folder access needs to be re-allowed.'), { needsUser: true });
    this.dir = h;
  },
  async _dir(path, create) {
    const parts = path.split('/'); const file = parts.pop();
    let d = this.dir;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return [d, file];
  },
  async read(path) {
    try { const [d, f] = await this._dir(path, false); return await (await d.getFileHandle(f)).getFile(); }
    catch (e) { if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null; throw e; }
  },
  async write(path, blob) {
    const [d, f] = await this._dir(path, true);
    const w = await (await d.getFileHandle(f, { create: true })).createWritable();
    await w.write(blob); await w.close();
  },
  async remove(path) { try { const [d, f] = await this._dir(path, false); await d.removeEntry(f); } catch { /* already gone */ } },
  async list(prefix) {
    const out = [];
    try {
      const d = await this.dir.getDirectoryHandle(prefix.replace(/\/$/, ''));
      for await (const [name, h] of d.entries()) if (h.kind === 'file') out.push({ name: prefix + name });
    } catch { /* folder not created yet */ }
    return out;
  },
};

/* ---- OAuth (implicit flow) shared by Google Drive, Dropbox and OneDrive ----------------------------
 * You register a free app with the provider and paste its client/app ID into Folio's sync settings.
 * Redirect URI to register: shown in the dialog (extension: https://<id>.chromiumapp.org/, web: .../oauth.html). */
const redirectUri = () => (globalThis.chrome?.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : new URL('oauth.html', location.href).href);
async function oauthHash(url) {
  if (globalThis.chrome?.identity?.launchWebAuthFlow) return new URL(await chrome.identity.launchWebAuthFlow({ url, interactive: true })).hash;
  return new Promise((res, rej) => {
    const w = open(url, 'folio-oauth', 'width=480,height=660');
    if (!w) return rej(new Error('The sign-in pop-up was blocked.'));
    const on = (e) => { if (e.origin === location.origin && e.data?.folioOAuth) { removeEventListener('message', on); clearInterval(iv); res(e.data.hash); } };
    const iv = setInterval(() => { if (w.closed) { clearInterval(iv); removeEventListener('message', on); rej(new Error('Sign-in cancelled.')); } }, 500);
    addEventListener('message', on);
  });
}
const tokKey = (id) => 'sw-tok-' + id;
async function oauthToken(id, buildUrl, clientId, interactive) {
  if (!clientId) throw new Error('Add your client ID in the sync settings first.');
  let t = lsGet(tokKey(id), null);
  if (t && t.exp > Date.now() + 60e3) return t.token;
  if (!interactive) throw Object.assign(new Error('Sign-in expired. Open Sync and press Reconnect.'), { needsUser: true });
  const p = new URLSearchParams((await oauthHash(buildUrl(clientId, redirectUri()))).replace(/^#/, ''));
  if (!p.get('access_token')) throw new Error(p.get('error_description') || p.get('error') || 'Sign-in failed.');
  t = { token: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 };
  lsSet(tokKey(id), t);
  return t.token;
}
const expired = (id) => { lsSet(tokKey(id), null); return Object.assign(new Error('Sign-in expired. Open Sync and press Reconnect.'), { needsUser: true }); };
const clientIdOf = (id) => getCfg().ids[id] || '';

/** Google Drive - the app's private, hidden app-data space (scope drive.appdata). */
export const driveProvider = {
  id: 'drive', label: 'Google Drive', kind: 'oauth', supported: () => true,
  hint: 'Google Cloud Console → APIs & Services → Credentials → OAuth client ID (type: Web application). Enable the Google Drive API.',
  redirect: redirectUri,
  async ready(interactive) {
    this.token = await oauthToken('drive', (cid, ru) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: cid, redirect_uri: ru, response_type: 'token', scope: 'https://www.googleapis.com/auth/drive.appdata', prompt: 'select_account' }), clientIdOf('drive'), interactive);
  },
  signOut() { lsSet(tokKey('drive'), null); },
  async _api(url, init = {}) {
    const r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + this.token, ...(init.headers || {}) } });
    if (r.status === 401) throw expired('drive');
    if (!r.ok && r.status !== 404) throw new Error(`Google Drive error ${r.status}`);
    return r;
  },
  _flat: (p) => p.replace(/\//g, '__'),
  async _files() {
    const out = []; let pageToken = '';
    do {
      const r = await this._api('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name,size)', ...(pageToken ? { pageToken } : {}) }));
      const j = await r.json(); out.push(...(j.files || [])); pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  },
  async _find(path) { const n = this._flat(path); return (await this._files()).find((f) => f.name === n) || null; },
  async read(path) {
    const f = await this._find(path); if (!f) return null;
    return (await this._api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).blob();
  },
  async write(path, blob) {
    const f = await this._find(path);
    if (f) { await this._api(`https://www.googleapis.com/upload/drive/v3/files/${f.id}?uploadType=media`, { method: 'PATCH', body: blob }); return; }
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify({ name: this._flat(path), parents: ['appDataFolder'] })], { type: 'application/json' }));
    fd.append('file', blob);
    await this._api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', body: fd });
  },
  async remove(path) { const f = await this._find(path); if (f) await this._api(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' }); },
  async list(prefix) {
    const p = this._flat(prefix);
    return (await this._files()).filter((f) => f.name.startsWith(p)).map((f) => ({ name: f.name.replace(/__/g, '/') }));
  },
};

/** Dropbox - an "App folder" app, so Folio only ever sees its own folder (Apps/<your app name>). */
export const dropboxProvider = {
  id: 'dropbox', label: 'Dropbox', kind: 'oauth', supported: () => true,
  hint: 'dropbox.com/developers/apps → Create app → Scoped access → App folder. Permissions: files.content.write and files.content.read. Use its App key.',
  redirect: redirectUri,
  async ready(interactive) {
    this.token = await oauthToken('dropbox', (cid, ru) => 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({ client_id: cid, redirect_uri: ru, response_type: 'token' }), clientIdOf('dropbox'), interactive);
  },
  signOut() { lsSet(tokKey('dropbox'), null); },
  async _call(url, init = {}) {
    const r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + this.token, ...(init.headers || {}) } });
    if (r.status === 401) throw expired('dropbox');
    return r;
  },
  async read(path) {
    const r = await this._call('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': JSON.stringify({ path: '/' + path }) } });
    if (r.status === 409) return null;
    if (!r.ok) throw new Error(`Dropbox error ${r.status}`);
    return r.blob();
  },
  async write(path, blob) {
    const r = await this._call('https://content.dropboxapi.com/2/files/upload', { method: 'POST', body: blob,
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: '/' + path, mode: 'overwrite', mute: true }) } });
    if (!r.ok) throw new Error(`Dropbox error ${r.status}`);
  },
  async remove(path) {
    await this._call('https://api.dropboxapi.com/2/files/delete_v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/' + path }) });
  },
  async list(prefix) {
    const out = [];
    let r = await this._call('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/' + prefix.replace(/\/$/, ''), limit: 2000 }) });
    while (r.ok) {
      const j = await r.json();
      for (const e of j.entries) if (e['.tag'] === 'file') out.push({ name: prefix + e.name });
      if (!j.has_more) break;
      r = await this._call('https://api.dropboxapi.com/2/files/list_folder/continue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: j.cursor }) });
    }
    return out; // a missing folder (409) just means nothing uploaded yet
  },
};

/** Microsoft OneDrive - the app's own folder (Apps/<your app name>) via Microsoft Graph. */
export const onedriveProvider = {
  id: 'onedrive', label: 'Microsoft OneDrive', kind: 'oauth', supported: () => true,
  hint: 'portal.azure.com → App registrations → New (Accounts in any org + personal Microsoft accounts) → Authentication → add a Single-page application redirect URI and tick "Access tokens". Delegated permission: Files.ReadWrite.AppFolder. Use the Application (client) ID.',
  redirect: redirectUri,
  async ready(interactive) {
    this.token = await oauthToken('onedrive', (cid, ru) => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + new URLSearchParams({
      client_id: cid, redirect_uri: ru, response_type: 'token', scope: 'Files.ReadWrite.AppFolder', response_mode: 'fragment', prompt: 'select_account' }), clientIdOf('onedrive'), interactive);
  },
  signOut() { lsSet(tokKey('onedrive'), null); },
  _url: (path, tail = '') => 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/' + path.split('/').map(encodeURIComponent).join('/') + ':' + tail,
  async _call(url, init = {}) {
    const r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + this.token, ...(init.headers || {}) } });
    if (r.status === 401) throw expired('onedrive');
    return r;
  },
  async read(path) {
    const r = await this._call(this._url(path, '/content'));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`OneDrive error ${r.status}`);
    return r.blob();
  },
  async write(path, blob) {
    if (blob.size < 4e6) {
      const r = await this._call(this._url(path, '/content'), { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!r.ok) throw new Error(`OneDrive error ${r.status}`);
      return;
    }
    const s = await this._call(this._url(path, '/createUploadSession'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
    if (!s.ok) throw new Error(`OneDrive error ${s.status}`);
    const { uploadUrl } = await s.json();
    const CH = 320 * 1024 * 10;
    for (let o = 0; o < blob.size; o += CH) {
      const part = blob.slice(o, Math.min(o + CH, blob.size));
      const r = await fetch(uploadUrl, { method: 'PUT', body: part, headers: { 'Content-Range': `bytes ${o}-${o + part.size - 1}/${blob.size}` } });
      if (!r.ok && r.status !== 202) throw new Error(`OneDrive upload error ${r.status}`);
    }
  },
  async remove(path) { await this._call(this._url(path), { method: 'DELETE' }); },
  async list(prefix) {
    const r = await this._call(this._url(prefix.replace(/\/$/, ''), '/children?$select=name,file&$top=1000'));
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`OneDrive error ${r.status}`);
    return (await r.json()).value.filter((e) => e.file).map((e) => ({ name: prefix + e.name }));
  },
};

/** Your own server - any WebDAV share (Nextcloud, ownCloud, Synology, a NAS, Apache/nginx dav, ...). */
export const webdavProvider = {
  id: 'webdav', label: 'Your own server (WebDAV)', kind: 'webdav', supported: () => true,
  hint: 'Enter the folder URL on your server, e.g. https://cloud.example.com/remote.php/dav/files/you/Folio/ (Nextcloud). The server must allow CORS if you use the web/phone app.',
  _conf() { return getCfg().dav; },
  async ready() {
    const { url, user, pass } = this._conf();
    if (!url) throw new Error(this.kind === 'nextcloud' ? 'Enter your Nextcloud address and user name in the sync settings.' : 'Enter your WebDAV folder URL in the sync settings.');
    this.base = url.replace(/\/*$/, '/');
    this.auth = user || pass ? 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`))) : null;
    if (globalThis.chrome?.permissions?.contains) {
      const origin = new URL(this.base).origin + '/*';
      if (!(await chrome.permissions.contains({ origins: [origin] }))) throw Object.assign(new Error('Allow access to your server in the sync settings (Save & connect).'), { needsUser: true });
    }
    // make sure the folder exists
    const r = await this._call('', { method: 'PROPFIND', headers: { Depth: '0' } });
    if (r.status === 404) { const m = await this._call('', { method: 'MKCOL' }); if (!m.ok) throw new Error('The folder does not exist and could not be created.'); }
    else if (r.status === 401) throw new Error('Wrong user name or password.');
    else if (!r.ok && r.status !== 207) throw new Error(`Server error ${r.status}`);
  },
  async grant() {
    if (!globalThis.chrome?.permissions?.request) return true;
    const { url } = this._conf();
    return chrome.permissions.request({ origins: [new URL(url).origin + '/*'] });
  },
  _call(path, init = {}) {
    return fetch(this.base + path.split('/').map(encodeURIComponent).join('/'), { ...init, headers: { ...(this.auth ? { Authorization: this.auth } : {}), ...(init.headers || {}) } });
  },
  async read(path) {
    const r = await this._call(path);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    return r.blob();
  },
  async write(path, blob) {
    if (path.includes('/')) await this._call(path.split('/')[0], { method: 'MKCOL' }); // ignore "already exists"
    const r = await this._call(path, { method: 'PUT', body: blob });
    if (!r.ok) throw new Error(`Server error ${r.status}`);
  },
  async remove(path) { await this._call(path, { method: 'DELETE' }); },
  async list(prefix) {
    const r = await this._call(prefix, { method: 'PROPFIND', headers: { Depth: '1' } });
    if (r.status === 404) return [];
    if (r.status !== 207 && !r.ok) throw new Error(`Server error ${r.status}`);
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const out = [];
    for (const resp of xml.getElementsByTagNameNS('*', 'response')) {
      const href = decodeURIComponent(resp.getElementsByTagNameNS('*', 'href')[0]?.textContent || '');
      if (resp.getElementsByTagNameNS('*', 'collection').length) continue;
      const name = href.split('/').pop();
      if (name) out.push({ name: prefix + name });
    }
    return out;
  },
};


/** Nextcloud - a WebDAV share with the address worked out for you. Use an app password, not your login. */
export const nextcloudProvider = {
  ...webdavProvider,
  id: 'nextcloud', label: 'Nextcloud', kind: 'nextcloud',
  hint: 'In Nextcloud: Settings → Security → Devices & sessions → "Create new app password". Use that instead of your normal password. Folio stores its data in a folder named Folio.',
  _conf() {
    const { server, user, pass, folder } = getCfg().nc;
    const s = server.trim().replace(/\/+$/, '').replace(/\/(index\.php|remote\.php|apps)(\/.*)?$/, '');
    if (!s || !user) return { url: '', user, pass };
    const dir = (folder || 'Folio').replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/');
    return { url: `${/^https?:\/\//.test(s) ? s : 'https://' + s}/remote.php/dav/files/${encodeURIComponent(user.trim())}/${dir}/`, user, pass };
  },
};
export const PROVIDERS = { folder: folderProvider, drive: driveProvider, dropbox: dropboxProvider, onedrive: onedriveProvider, nextcloud: nextcloudProvider, webdav: webdavProvider };

/* ============================================================================== merge (pure) */
const stamp = (r) => r.updatedAt || r.created || r.added || 0;
const bookStamp = (b) => Math.max(b.updatedAt || 0, b.posAt || 0, b.added || 0);
const POS = ['pos', 'progress', 'status', 'pages'];
const clean = (b) => { const { cover, ...rest } = b; return rest; };

export function mergeBook(a, b) {
  if (!a) return b; if (!b) return a;
  const meta = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
  const pos = (a.posAt || 0) >= (b.posAt || 0) ? a : b;
  const m = { ...meta };
  for (const k of POS) if (k in pos) m[k] = pos[k]; else delete m[k];
  m.readMs = Math.max(a.readMs || 0, b.readMs || 0);
  m.lastOpened = Math.max(a.lastOpened || 0, b.lastOpened || 0);
  m.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  m.posAt = Math.max(a.posAt || 0, b.posAt || 0);
  return m;
}

/** local/remote: { books, highlights, bookmarks } as id->record maps; tombs: "store:id"->time. */
export function mergeAll(local, remote, now = Date.now()) {
  const tombs = {};
  for (const t of [local.tombs || {}, remote.tombs || {}]) for (const [k, at] of Object.entries(t)) tombs[k] = Math.max(tombs[k] || 0, at);
  for (const k of Object.keys(tombs)) if (now - tombs[k] > TOMB_TTL) delete tombs[k];

  const out = { books: {}, highlights: {}, bookmarks: {}, tombs };
  const dead = (store, id, rec) => { const t = tombs[`${store}:${id}`]; return t && t > (store === 'books' ? bookStamp(rec) : stamp(rec)); };

  for (const id of new Set([...Object.keys(local.books || {}), ...Object.keys(remote.books || {})])) {
    const m = mergeBook(local.books?.[id], remote.books?.[id]);
    if (dead('books', id, m)) continue;
    out.books[id] = m;
    delete tombs['books:' + id]; // the record outlived its tombstone
  }
  for (const store of ['highlights', 'bookmarks']) {
    for (const id of new Set([...Object.keys(local[store] || {}), ...Object.keys(remote[store] || {})])) {
      const a = local[store]?.[id], b = remote[store]?.[id];
      const w = !a ? b : !b ? a : stamp(a) >= stamp(b) ? a : b;
      if (!out.books[w.bookId]) continue;   // its book was deleted (or is unknown everywhere)
      if (dead(store, id, w)) continue;
      out[store][id] = w;
      delete tombs[`${store}:${id}`];
    }
  }
  return out;
}

const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1))) : v));
const byId = (arr) => Object.fromEntries(arr.map((r) => [r.id, r]));

/* ============================================================================== engine */
let hooks = { onChange: null, importFile: null, onStatus: null };
export const configure = (h) => { hooks = { ...hooks, ...h }; };
export const state = { running: false, message: '', error: '' };
const status = (patch) => { Object.assign(state, patch); hooks.onStatus?.(state); };

async function localSnapshot() {
  const [books, hl, bm, tombs] = await Promise.all([db.all('books'), db.all('highlights'), db.all('bookmarks'), db.all('tombs')]);
  const t = {}; for (const x of tombs) t[`${x.store}:${x.id}`] = x.at;
  return { books: byId(books.map(clean)), highlights: byId(hl), bookmarks: byId(bm), tombs: t, _books: byId(books) };
}

async function applyLocal(snap, merged) {
  let changed = false;
  // deletions decided by the merge
  for (const [store, key] of [['books', 'books'], ['highlights', 'highlights'], ['bookmarks', 'bookmarks']]) {
    for (const id of Object.keys(snap[key])) {
      if (merged[key][id]) continue;
      changed = true;
      if (store === 'books') { await db.del('books', id, { raw: true }); await db.del('files', id, { raw: true }); await db.delByBook('highlights', id); await db.delByBook('bookmarks', id); }
      else await db.del(store, id, { raw: true });
    }
  }
  // tombstones: remember them locally so they keep propagating
  for (const [k, at] of Object.entries(merged.tombs)) {
    const [store, ...rest] = k.split(':');
    await db.putRaw('tombs', { store, id: rest.join(':'), at }, k);
  }
  // updated / new records for books we actually have
  for (const [id, b] of Object.entries(merged.books)) {
    const cur = snap._books[id];
    if (!cur) continue;                                      // remote-only book (file not synced here)
    if (canon(clean(cur)) !== canon(b)) { await db.put('books', { ...b, cover: cur.cover }, undefined, { raw: true }); changed = true; }
  }
  for (const store of ['highlights', 'bookmarks']) {
    for (const [id, r] of Object.entries(merged[store])) {
      if (!snap._books[r.bookId]) continue;
      if (canon(snap[store][id] || null) !== canon(r)) { await db.put(store, r, undefined, { raw: true }); changed = true; }
    }
  }
  return changed;
}

async function syncFiles(provider, merged) {
  const cfg = getCfg();
  if (!cfg.files) return false;
  let changed = false;
  const remote = new Map((await provider.list('books/')).map((f) => [f.name.slice(6).replace(/\.[^.]+$/, ''), f.name]));
  const localIds = new Set((await db.all('books')).map((b) => b.id));
  // remove remote copies of deleted books
  for (const [id, name] of remote) if (!merged.books[id]) { await provider.remove(name); remote.delete(id); }
  // upload what only this device has
  for (const b of await db.all('books')) {
    if (remote.has(b.id) || !merged.books[b.id]) continue;
    const file = await db.get('files', b.id);
    if (file) { status({ message: `Uploading “${b.title}”…` }); await provider.write(`books/${b.id}.${b.format}`, file); }
  }
  // download what only the cloud has
  for (const [id, name] of remote) {
    if (localIds.has(id) || !merged.books[id] || !hooks.importFile) continue;
    status({ message: `Downloading “${merged.books[id].title}”…` });
    const blob = await provider.read(name);
    if (blob) {
      await hooks.importFile(new File([blob], `${id}.${extOf(name)}`));
      // the import guessed title etc. from the file name: restore the real metadata from the cloud copy
      const cur = (await db.all('books')).find((x) => x.id === id);
      if (cur) await db.put('books', { ...merged.books[id], cover: cur.cover }, undefined, { raw: true });
      changed = true;
    }
  }
  return changed;
}

export async function run({ interactive = false } = {}) {
  const cfg = getCfg();
  const provider = PROVIDERS[cfg.provider];
  if (!provider || state.running) return;
  status({ running: true, message: 'Syncing…', error: '' });
  try {
    await provider.ready(interactive);
    const snap = await localSnapshot();
    const blob = await provider.read(DATA);
    const remote = blob ? JSON.parse(await blob.text()) : { books: {}, highlights: {}, bookmarks: {}, tombs: {} };
    const merged = mergeAll(snap, remote);
    let changed = await applyLocal(snap, merged);
    if (await syncFiles(provider, merged)) {
      changed = true;
      await applyLocal(await localSnapshot(), merged); // bookmarks/highlights for books that just arrived
    }
    const body = { v: 1, books: merged.books, highlights: merged.highlights, bookmarks: merged.bookmarks, tombs: merged.tombs };
    const remoteCanon = canon({ v: 1, books: remote.books || {}, highlights: remote.highlights || {}, bookmarks: remote.bookmarks || {}, tombs: remote.tombs || {} });
    if (!blob || canon(body) !== remoteCanon) await provider.write(DATA, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    setCfg({ lastSync: Date.now(), lastError: '', connected: true });  // only a successful sync turns Sync on
    status({ running: false, message: 'Up to date', error: '' });
    if (changed) hooks.onChange?.();
  } catch (e) {
    console.error('sync', e);
    setCfg({ lastError: e.message || String(e) });
    status({ running: false, message: '', error: e.message || String(e), needsUser: !!e.needsUser });
  }
}

let timer;
export function schedule(ms = 15000) {
  const cfg = getCfg();
  if (!cfg.provider || !cfg.auto || !cfg.connected) return;
  clearTimeout(timer);
  timer = setTimeout(() => run(), ms);
}

export function start() {
  db.setOnWrite(() => schedule());
  const cfg = getCfg();
  if (cfg.provider && cfg.auto && cfg.connected) setTimeout(() => run(), 1500);
  document.addEventListener('visibilitychange', () => {
    const c = getCfg();
    if (document.visibilityState === 'visible' && c.provider && c.auto && c.connected && Date.now() - c.lastSync > 5 * 60e3) run();
  });
}
