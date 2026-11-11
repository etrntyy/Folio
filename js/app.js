import * as db from './db.js';
import { openEpub } from './epub.js';
import { openReader, refreshReaderTheme } from './reader.js';
import { pdfCover } from './pdf.js';
import * as sync from './sync.js';
import * as upd from './update.js';
import { $, $$, esc, uid, lsGet, lsSet, toast, menu, closePop, modal, closeModal, askText, confirmBox, download, ACCENTS, getAppearance, setAppearance, applyAppearance } from './ui.js';

/* ------------------------------------------------------------------ cloud sync settings */
function ago(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
}
// Sync lives in its own sidebar section (the menu entry just opens it).
// Sync only counts as On after a first successful sync; picking a provider alone is just 'Setup'.
function syncBadge() {
  const c = sync.getCfg();
  if (!c.provider) return { text: 'Off', cls: '' };
  if (!c.connected) return { text: 'Setup', cls: 'setup' };
  return c.lastError ? { text: 'Error', cls: 'err' } : { text: 'On', cls: 'on' };
}
function syncDialog() { S.filter = 'sync'; lsSet('sw-filter', S.filter); S.sel.clear(); render(); }
function syncPanel(host) {
  const d = document.createElement('div'); d.className = 'syncwrap'; host.replaceChildren(d);
  const paint = () => {
    const cfg = sync.getCfg(), P = sync.PROVIDERS, cur = P[cfg.provider];
    const opts = Object.values(P).filter((p) => p.supported());
    let body = '';
    if (cur?.id === 'folder') {
      body = `<label>Folder</label><div class="two" style="grid-template-columns:1fr auto;align-items:center"><span id="sy-dir" style="color:var(--muted)">checking…</span><button data-act="pick">Choose folder…</button></div>
        <p class="sy-note">Pick a folder that your cloud app already syncs (Google Drive, OneDrive, Dropbox, iCloud Drive…). Folio keeps its data in that folder.</p>`;
    } else if (cur?.kind === 'oauth') {
      body = `<label>${cur.label} client ID</label><input type="text" id="sy-cid" value="${esc(cfg.ids[cur.id] || '')}" placeholder="Paste the client / app ID you registered" spellcheck="false">
        <p class="sy-note">${esc(cur.hint)}</p>
        <label>Redirect URI to register</label><input type="text" readonly value="${esc(cur.redirect())}" onfocus="this.select()">`;
    } else if (cur?.kind === 'nextcloud') {
      body = `<label>Nextcloud address</label><input type="text" id="sy-ncs" value="${esc(cfg.nc.server)}" placeholder="https://cloud.example.com" spellcheck="false">
        <div class="two"><div><label>User name</label><input type="text" id="sy-ncu" value="${esc(cfg.nc.user)}" autocomplete="off"></div><div><label>App password</label><input type="password" id="sy-ncp" value="${esc(cfg.nc.pass)}" autocomplete="off"></div></div>
        <label>Folder</label><input type="text" id="sy-ncf" value="${esc(cfg.nc.folder)}" placeholder="Folio">
        <p class="sy-note">${esc(cur.hint)} The password is stored in this browser only.</p>`;
    } else if (cur?.kind === 'webdav') {
      body = `<label>Folder URL</label><input type="text" id="sy-url" value="${esc(cfg.dav.url)}" placeholder="https://cloud.example.com/remote.php/dav/files/you/Folio/" spellcheck="false">
        <div class="two"><div><label>User name</label><input type="text" id="sy-user" value="${esc(cfg.dav.user)}" autocomplete="off"></div><div><label>Password / app password</label><input type="password" id="sy-pass" value="${esc(cfg.dav.pass)}" autocomplete="off"></div></div>
        <p class="sy-note">${esc(cur.hint)} The password is stored in this browser only; use an app password, not your main one.</p>`;
    }
    d.innerHTML = `<label style="margin-top:0">Where to sync</label>
      <select id="sy-prov" style="width:100%"><option value="">Off: keep everything on this device</option>${opts.map((p) => `<option value="${p.id}" ${cfg.provider === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
      ${body}
      ${cur ? `<label class="sy-check"><input type="checkbox" id="sy-auto" ${cfg.auto ? 'checked' : ''}> Sync automatically</label>
      <label class="sy-check"><input type="checkbox" id="sy-files" ${cfg.files ? 'checked' : ''}> Also sync the book files (uses more storage and bandwidth)</label>
      <p class="sy-note">Always synced: reading progress, bookmarks, highlights, notes, ratings, tags and removals. The most recent change wins.</p>
      <div id="sy-status" class="sy-status"></div>` : ''}
      <div class="acts">${cur ? '<button data-act="now" class="primary">Save &amp; sync now</button>' : ''}</div>`;
    const status = () => {
      const el = $('#sy-status', d); if (!el) return;
      const c = sync.getCfg(), st = sync.state;
      el.innerHTML = st.running ? `<span>${esc(st.message || 'Syncing…')}</span>` : st.error || c.lastError ? `<span class="err">${esc(st.error || c.lastError)}</span>` : !c.connected ? `<span>Not connected yet. Fill in the details above and press Save &amp; sync now.</span>` : `<span>Last synced: ${ago(c.lastSync)}</span>`;
    };
    status(); d._status = status;
    if (cur?.id === 'folder') sync.folderProvider.handle().then((h) => { const el = $('#sy-dir', d); if (el) el.textContent = h ? h.name : 'No folder chosen'; });
    $('#sy-prov', d).onchange = (e) => { sync.setCfg({ provider: e.target.value || null, connected: false, lastSync: 0, lastError: '' }); sync.state.error = ''; paint(); renderSide(); };
    const save = () => {
      const patch = {};
      if ($('#sy-auto', d)) patch.auto = $('#sy-auto', d).checked;
      if ($('#sy-files', d)) patch.files = $('#sy-files', d).checked;
      if ($('#sy-cid', d)) patch.ids = { ...sync.getCfg().ids, [cur.id]: $('#sy-cid', d).value.trim() };
      if ($('#sy-ncs', d)) patch.nc = { server: $('#sy-ncs', d).value.trim(), user: $('#sy-ncu', d).value.trim(), pass: $('#sy-ncp', d).value, folder: $('#sy-ncf', d).value.trim() || 'Folio' };
      if ($('#sy-url', d)) patch.dav = { url: $('#sy-url', d).value.trim(), user: $('#sy-user', d).value, pass: $('#sy-pass', d).value };
      sync.setCfg(patch);
    };
    $$('input', d).forEach((i) => (i.onchange = save));
    d.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'pick') { try { await sync.folderProvider.choose(); } catch { /* cancelled */ } paint(); return; }
      if (act === 'now') {
        save();
        if ((cur.kind === 'webdav' || cur.kind === 'nextcloud') && !(await cur.grant())) { sync.state.error = 'Access to your server was not allowed.'; return d._status(); }
        sync.state.error = '';
        await sync.run({ interactive: true });
        d._status();
      }
    };
  };
  sync.configure({ onStatus: () => d._status?.() });
  paint();
}

function appearanceDialog() {
  const d = modal('');
  const draw = () => {
    const { theme, accent } = getAppearance();
    const isPreset = ACCENTS.some(([, c]) => c === accent);
    d.innerHTML = `<h3>Appearance</h3>
      <label>Theme</label>
      <div class="optrow">${[['system', 'Match browser'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button data-theme="${k}" class="${theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label>Accent colour</label>
      <div class="swatches">
        ${ACCENTS.map(([n, c]) => `<button class="swatch ${accent === c ? 'on' : ''}" data-accent="${c || ''}" title="${n}" style="background:${c || 'var(--accent)'}"></button>`).join('')}
        <input type="color" class="swatch-custom" id="acc-custom" value="${accent || '#3b6ef5'}" title="Custom colour">
        ${accent && !isPreset ? '<span style="color:var(--muted);font-size:12px">Custom</span>' : ''}
      </div>
      <div class="acts"><button data-reset>Reset</button><button class="primary" data-x>Done</button></div>`;
    $$('[data-theme]', d).forEach((b) => (b.onclick = () => { setAppearance({ theme: b.dataset.theme }, refreshReaderTheme); draw(); }));
    $$('[data-accent]', d).forEach((b) => (b.onclick = () => { setAppearance({ accent: b.dataset.accent || null }, refreshReaderTheme); draw(); }));
    $('#acc-custom', d).oninput = (e) => setAppearance({ accent: e.target.value }, refreshReaderTheme);
    $('#acc-custom', d).onchange = draw;
    $('[data-reset]', d).onclick = () => { setAppearance({ theme: 'system', accent: null }, refreshReaderTheme); draw(); };
    $('[data-x]', d).onclick = closeModal;
  };
  draw();
}
applyAppearance();
// Installable web app (phones): offline shell. Not used inside the Chrome extension.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !globalThis.chrome?.runtime?.id) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => refreshReaderTheme());

const STATUS = { unread: 'Want to read', reading: 'Reading', finished: 'Finished' };
const S = {
  books: [], bm: [], collections: [], filter: lsGet('sw-filter', 'all'), q: '', sel: new Set(), lastSel: null,
  sort: lsGet('sw-sort', 'recent'), view: lsGet('sw-view', 'grid'),
};
const coverUrls = new Map();

/* ------------------------------------------------------------------ data */
async function refresh() {
  S.books = await db.all('books');
  S.bm = await db.all('bookmarks');
  S.collections = (await db.get('kv', 'collections')) || [];
  for (const b of S.books) for (const c of b.collections || []) if (!S.collections.includes(c)) S.collections.push(c);
  S.collections.sort((a, b) => a.localeCompare(b));
  S.sel = new Set([...S.sel].filter((id) => S.books.some((b) => b.id === id)));
  render();
  backfillCovers();
}
const saveCollections = () => db.put('kv', S.collections, 'collections');
const byId = (id) => S.books.find((b) => b.id === id);
const save = (b) => { b.updatedAt = Date.now(); return db.put('books', b); }; // updatedAt = metadata edit time (sync)

function coverUrl(b) {
  if (!b.cover) return null;
  if (!coverUrls.has(b.id)) coverUrls.set(b.id, URL.createObjectURL(b.cover));
  return coverUrls.get(b.id);
}
const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

/* ------------------------------------------------------------------ filtering */
function visible() {
  const f = S.filter, q = S.q.trim().toLowerCase();
  let list = S.books.filter((b) => {
    if (f === 'reading' && b.status !== 'reading') return false;
    if (f === 'unread' && b.status !== 'unread') return false;
    if (f === 'finished' && b.status !== 'finished') return false;
    if (f === 'fav' && !b.favorite) return false;
    if (f.startsWith('c:') && !(b.collections || []).includes(f.slice(2))) return false;
    if (f.startsWith('t:') && !(b.tags || []).includes(f.slice(2))) return false;
    if (f.startsWith('f:') && b.format !== f.slice(2)) return false;
    if (!q) return true;
    return [b.title, b.author, b.series, ...(b.tags || []), ...(b.collections || [])].join('\n').toLowerCase().includes(q);
  });
  const cmp = {
    recent: (a, b) => (b.lastOpened || 0) - (a.lastOpened || 0) || b.added - a.added,
    added: (a, b) => b.added - a.added,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
    author: (a, b) => (a.author || '~').localeCompare(b.author || '~') || a.title.localeCompare(b.title),
    progress: (a, b) => (b.progress || 0) - (a.progress || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  }[S.sort];
  return list.sort(cmp);
}

/* ------------------------------------------------------------------ rendering */
function render() { renderSide(); renderMain(); renderSelBar(); }

function renderSide() {
  const count = (fn) => S.books.filter(fn).length;
  const item = (id, label, n) => `<button class="nav-i ${S.filter === id ? 'on' : ''}" data-f="${esc(id)}"><span>${esc(label)}</span><span>${n}</span></button>`;
  const tags = {};
  for (const b of S.books) for (const t of b.tags || []) tags[t] = (tags[t] || 0) + 1;
  $('#nav').innerHTML =
    item('all', 'Library', S.books.length) +
    item('reading', 'Reading', count((b) => b.status === 'reading')) +
    item('unread', 'Want to read', count((b) => b.status === 'unread')) +
    item('finished', 'Finished', count((b) => b.status === 'finished')) +
    item('fav', 'Favorites', count((b) => b.favorite)) +
    item('bookmarks', 'Bookmarks', S.bm.filter((m) => byId(m.bookId)).length) +
    `<div class="nav-h" style="padding-top:14px">Cloud</div>` +
    `<button class="nav-i ${S.filter === 'sync' ? 'on' : ''}" data-f="sync"><span>Sync</span><span class="syncdot ${syncBadge().cls}">${syncBadge().text}</span></button>` +
    `<div class="nav-h"><span>Collections</span><button id="add-col" title="New collection" aria-label="New collection"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>` +
    (S.collections.map((c) => item('c:' + c, c, count((b) => (b.collections || []).includes(c)))).join('')) +
    (Object.keys(tags).length ? `<div class="nav-h">Tags</div>` + Object.keys(tags).sort().map((t) => item('t:' + t, '# ' + t, tags[t])).join('') : '') +
    (S.books.length ? `<div class="nav-h">Format</div>` : '') +
    ['epub', 'pdf', 'txt'].filter((f) => S.books.some((b) => b.format === f)).map((f) => item('f:' + f, f.toUpperCase(), count((b) => b.format === f))).join('') +
    `<div class="nav-bottom"><div class="nav-h">Support</div><button class="nav-i ${S.filter === 'about' ? 'on' : ''}" data-f="about"><span>About &amp; updates</span><span class="syncdot ${upd.updateAvailable() ? 'on' : ''}">${upd.updateAvailable() ? 'Update' : ''}</span></button><button class="nav-i ${S.filter === 'support' ? 'on' : ''}" data-f="support"><span>Buy me a coffee</span><span></span></button></div>`;
}

function cardCover(b) {
  const u = coverUrl(b);
  return u ? `<img src="${u}" alt="" loading="lazy">`
    : `<div class="gen"><b>${esc(b.title)}</b>${b.author ? `<span>${esc(b.author)}</span>` : ''}</div>`;
}

// Books added before PDF covers existed: render page 1 once, in the background.
let backfilling = false;
async function backfillCovers() {
  if (backfilling) return;
  backfilling = true;
  try {
    for (const b of S.books.filter((x) => x.format === 'pdf' && !x.cover && !x.coverTried)) {
      b.coverTried = true;
      const file = await db.get('files', b.id);
      const p = file ? await pdfCover(await file.arrayBuffer()) : null;
      if (p?.blob) b.cover = await shrink(p.blob);
      await save(b);
      if (b.cover) render();
    }
  } finally { backfilling = false; }
}

const bmLabel = (m) => m.label || (m.page ? `Page ${m.page}` : `${Math.round((m.progress || 0) * 100)}% through the book`);

function renderBookmarks() {
  const q = S.q.trim().toLowerCase();
  const groups = S.books.map((b) => ({ b, marks: S.bm.filter((m) => m.bookId === b.id).sort((x, y) => y.created - x.created) }))
    .filter((g) => g.marks.length && (!q || (g.b.title + ' ' + g.b.author).toLowerCase().includes(q)))
    .sort((x, y) => y.marks[0].created - x.marks[0].created);
  const total = groups.reduce((a, g) => a + g.marks.length, 0);
  $('#h1').textContent = 'Bookmarks';
  $('#stats').textContent = `${total} bookmark${total === 1 ? '' : 's'} in ${groups.length} book${groups.length === 1 ? '' : 's'}`;
  const box = $('#books');
  box.className = 'bmlist';
  box.innerHTML = groups.map((g) => `
    <section class="bmgroup">
      <div class="bmhead" data-id="${g.b.id}"><div class="cover">${cardCover(g.b)}</div>
        <div><div class="t">${esc(g.b.title)}</div><div class="a">${esc(g.b.author) || '&nbsp;'}</div></div></div>
      <div class="bmitems">${g.marks.map((m) => `
        <div class="bmitem" data-bmid="${m.id}" data-id="${g.b.id}">
          <span class="bl">${esc(bmLabel(m))}</span><span class="bs">${Math.round((m.progress || 0) * 100)}%</span><span class="bs">${new Date(m.created).toLocaleDateString()}</span>
          <button class="more" data-delbm="${m.id}" title="Remove bookmark" style="opacity:1"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>`).join('')}</div>
    </section>`).join('') || '<p style="color:var(--muted);padding:30px 4px">No bookmarks yet. Press B while reading to bookmark a page, and it will show up here for one-click access.</p>';
}

const COFFEE_URL = 'https://buymeacoffee.com/etrntyy';

function renderAbout() {
  $('#viewseg').hidden = true; $('#sort').hidden = true; $('#empty').hidden = true;
  $('#lib .heading').hidden = false; $('#h1').textContent = 'About & updates'; $('#stats').textContent = '';
  const box = $('#books'); box.hidden = false; box.className = 'supportpage';
  const d = document.createElement('div'); d.className = 'about'; box.replaceChildren(d);
  let busy = '';
  const paint = () => {
    const c = upd.getCfg(), cur = upd.currentVersion(), avail = upd.updateAvailable();
    d.innerHTML = `
      <div class="ab-card">
        <div class="ab-row"><span>Installed version</span><b>${esc(cur)}</b></div>
        <div class="ab-row"><span>Latest on GitHub</span><b>${esc(c.latest || 'Not checked')}</b></div>
        <div class="ab-row"><span>Last checked</span><b>${ago(c.checkedAt)}</b></div>
        <div class="ab-status ${c.error ? 'err' : avail ? 'new' : ''}">${esc(busy || (c.error ? c.error : avail ? `Version ${c.latest} is available.` : c.latest ? 'You are up to date.' : 'Not checked yet.'))}</div>
        <div class="acts">
          ${avail ? `<button class="primary" data-act="update" ${busy ? 'disabled' : ''}>Update to ${esc(c.latest)}</button>` : ''}
          <button data-act="check" ${busy ? 'disabled' : ''}>Check now</button>
          <a class="ab-link" href="${upd.repoUrl}" target="_blank" rel="noopener noreferrer">View on GitHub</a>
        </div>
      </div>
      <label class="sy-check"><input type="checkbox" id="up-auto" ${c.auto ? 'checked' : ''}> Check for updates automatically (at most every 12 hours)</label>
      <p class="sy-note">${upd.isExtension
        ? `Updating downloads the latest files from <b>github.com/${esc(upd.REPO)}</b> into the folder you loaded Folio from, then reloads the extension. The first time, you pick that folder once. Your books and settings are not touched.`
        : `Updating refreshes Folio's offline copy and reloads the page. Your books and settings are not touched.`}
        Only the version number is fetched when checking; nothing about you or your library is sent. Updating runs whatever is on that repository's main branch, so only use a repository you trust.</p>`;
  };
  d.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || busy) return;
    if (act === 'check') { busy = 'Checking…'; paint(); await upd.check({ force: true }); busy = ''; paint(); renderSide(); }
    if (act === 'update') {
      busy = 'Starting…'; paint();
      try {
        if (upd.isExtension) await upd.updateExtension((m) => { busy = m; paint(); });
        else await upd.updateWebApp();
      } catch (err) {
        if (err?.name === 'AbortError') busy = ''; // folder picker cancelled
        else { busy = ''; upd.setCfg({ error: err.message || String(err) }); }
        paint();
      }
    }
  };
  d.onchange = (e) => { if (e.target.id === 'up-auto') upd.setCfg({ auto: e.target.checked }); };
  paint();
  upd.check().then(paint);
}

function renderSupport() {
  $('#viewseg').hidden = true; $('#sort').hidden = true; $('#empty').hidden = true;
  $('#lib .heading').hidden = false; $('#h1').textContent = 'Buy me a coffee'; $('#stats').textContent = '';
  const box = $('#books'); box.hidden = false; box.className = 'supportpage';
  box.innerHTML = `
    <div class="coffee">
      <svg viewBox="0 0 24 24" class="cup" aria-hidden="true"><path d="M5 9h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V9z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1 .8 1 .8 2M11 3.5c0 1 .8 1 .8 2"/></svg>
      <h2>Enjoying Folio?</h2>
      <p>Folio is free, private and open source. There are no ads, no accounts and no tracking, and your books never leave your device unless you turn on sync.</p>
      <p>If it makes your reading a little better, you can support its development with a coffee. It's completely optional, and every feature stays free either way.</p>
      <a class="coffee-btn" href="${COFFEE_URL}" target="_blank" rel="noopener noreferrer">Buy me a coffee</a>
      <div class="coffee-sub">Opens buymeacoffee.com in a new tab</div>
    </div>`;
}

function renderMain() {
  if (S.filter === 'about') return renderAbout();
  if (S.filter === 'support') return renderSupport();
  if (S.filter === 'sync') {
    $('#viewseg').hidden = true; $('#sort').hidden = true; $('#empty').hidden = true;
    $('#lib .heading').hidden = false; $('#h1').textContent = 'Sync'; $('#stats').textContent = '';
    const box = $('#books'); box.hidden = false; box.className = 'syncpage';
    if (!box.querySelector('.syncwrap')) syncPanel(box);   // keep what's being typed when other things refresh
    return;
  }
  if (S.filter === 'bookmarks') { $('#viewseg').hidden = true; $('#sort').hidden = true; $('#empty').hidden = S.books.length > 0; $('#lib .heading').hidden = S.books.length === 0; $('#books').hidden = S.books.length === 0; return renderBookmarks(); }
  $('#viewseg').hidden = false; $('#sort').hidden = false;
  const list = visible();
  const box = $('#books');
  box.className = S.view;
  $$('#viewseg button').forEach((x) => x.classList.toggle('on', x.dataset.view === S.view));
  $('#sort').value = S.sort;
  const names = { all: 'Library', reading: 'Reading', unread: 'Want to read', finished: 'Finished', fav: 'Favorites' };
  $('#h1').textContent = names[S.filter] || (S.filter.startsWith('c:') ? S.filter.slice(2) : S.filter.startsWith('t:') ? '#' + S.filter.slice(2) : S.filter.slice(2).toUpperCase());
  const hrs = S.books.reduce((a, b) => a + (b.readMs || 0), 0) / 3.6e6;
  $('#stats').textContent = `${list.length} book${list.length === 1 ? '' : 's'}` + (hrs >= 0.1 ? ` · ${hrs.toFixed(1)} h read in total` : '');
  $('#empty').hidden = S.books.length > 0;
  $('#lib .heading').hidden = S.books.length === 0;
  box.hidden = S.books.length === 0;

  if (S.view === 'grid') {
    box.innerHTML = list.map((b) => `
      <div class="card ${S.sel.has(b.id) ? 'sel' : ''}" data-id="${b.id}">
        <div class="cover">${cardCover(b)}${b.format === 'pdf' ? '<span class="fmt">PDF</span>' : ''}
          <button class="fav ${b.favorite ? 'on' : ''}" data-fav title="Favorite">♥</button></div>
        <div class="t" title="${esc(b.title)}">${esc(b.title)}</div>
        <div class="a">${esc(b.author) || '&nbsp;'}</div>
        <div class="meta">
          <span class="${b.status === 'unread' ? 'new' : ''}">${b.status === 'finished' ? 'Finished' : b.status === 'unread' ? 'New' : Math.round((b.progress || 0) * 100) + '%'}</span>
          ${b.rating ? `<span class="stars">${stars(b.rating)}</span>` : ''}
          <button class="more" data-more title="More"><svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg></button>
        </div>
      </div>`).join('');
  } else {
    box.innerHTML = list.map((b) => `
      <div class="row ${S.sel.has(b.id) ? 'sel' : ''}" data-id="${b.id}">
        <div class="cover">${cardCover(b)}</div>
        <div class="t" title="${esc(b.title)}">${esc(b.title)}${b.favorite ? ' <span style="color:#ff5d73">♥</span>' : ''}</div>
        <div class="m">${esc(b.author)}</div>
        <div class="m">${esc((b.collections || []).join(', '))}</div>
        <div class="m">${STATUS[b.status]}${b.progress > 0.002 && b.status === 'reading' ? ' · ' + Math.round(b.progress * 100) + '%' : ''}</div>
        <div class="stars">${stars(b.rating)}</div>
        <button class="more" data-more title="More"><svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg></button>
      </div>`).join('');
  }
  if (S.books.length && !list.length) box.innerHTML = '<p style="color:var(--muted);padding:30px 4px">No books match.</p>';
}

function renderSelBar() {
  const bar = $('#selbar');
  bar.hidden = S.sel.size === 0;
  if (!S.sel.size) return;
  bar.innerHTML = `<b>${S.sel.size} selected</b>
    <button data-bulk="col">Collection ▾</button><button data-bulk="status">Status ▾</button>
    <button data-bulk="tag">Add tag</button><button data-bulk="del" class="danger">Delete</button><button data-bulk="clear">✕</button>`;
}

/* ------------------------------------------------------------------ actions */
async function openBook(id, at = null) {
  const b = byId(id);
  const file = await db.get('files', id);
  if (!file) return toast('The file for this book is missing from storage.');
  try {
    await openReader(b, file, async () => { await refresh(); }, at);
  } catch (e) {
    console.error(e);
    toast('Could not open this book: ' + e.message);
    $('#reader').hidden = true; document.body.style.overflow = '';
  }
}

async function updateBooks(ids, fn) {
  for (const id of ids) { const b = byId(id); if (b) { fn(b); await save(b); } }
  await refresh();
}

async function deleteBooks(ids) {
  if (!(await confirmBox(`Delete ${ids.length} book${ids.length > 1 ? 's' : ''}?`, 'The files, reading progress, bookmarks and highlights will be permanently removed from this browser.'))) return;
  for (const id of ids) {
    await db.del('books', id); await db.del('files', id);
    await db.delByBook('highlights', id); await db.delByBook('bookmarks', id);
    if (coverUrls.has(id)) { URL.revokeObjectURL(coverUrls.get(id)); coverUrls.delete(id); }
    S.sel.delete(id);
  }
  await refresh();
  toast('Deleted');
}

function collectionMenu(ids, x, y) {
  const items = [{ lbl: 'Toggle collection' }];
  for (const c of S.collections) {
    const all = ids.every((id) => (byId(id).collections || []).includes(c));
    items.push({ label: (all ? '✓ ' : '    ') + c, fn: () => updateBooks(ids, (b) => { const s = new Set(b.collections || []); all ? s.delete(c) : s.add(c); b.collections = [...s]; }) });
  }
  items.push({ sep: true }, { label: '＋ New collection…', fn: async () => {
    const n = (await askText('New collection', ''))?.trim();
    if (!n) return;
    if (!S.collections.includes(n)) { S.collections.push(n); await saveCollections(); }
    await updateBooks(ids, (b) => { b.collections = [...new Set([...(b.collections || []), n])]; });
  } });
  menu(x, y, items);
}
function statusMenu(ids, x, y) {
  menu(x, y, Object.entries(STATUS).map(([k, v]) => ({ label: v, fn: () => updateBooks(ids, (b) => { b.status = k; b.posAt = Date.now(); if (k === 'finished') b.progress = 1; if (k === 'unread') { b.progress = 0; b.pos = null; } }) })));
}

function bookMenu(id, x, y) {
  const b = byId(id);
  const ids = S.sel.has(id) && S.sel.size > 1 ? [...S.sel] : [id];
  menu(x, y, [
    { label: 'Open', fn: () => openBook(id) },
    { label: 'Edit details…', fn: () => editBook(id) },
    { sep: true },
    { label: b.favorite ? 'Remove from favorites' : 'Add to favorites', fn: () => { const nv = !b.favorite; updateBooks(ids, (bk) => (bk.favorite = nv)); } },
    { label: 'Collections…', fn: () => collectionMenu(ids, x, y) },
    { label: 'Set status…', fn: () => statusMenu(ids, x, y) },
    { sep: true },
    { label: ids.length > 1 ? `Delete ${ids.length} books…` : 'Delete…', danger: true, fn: () => deleteBooks(ids) },
  ]);
}

function editBook(id) {
  const b = byId(id);
  let rating = b.rating || 0, newCover = null;
  const cols = new Set(b.collections || []);
  const d = modal(`
    <h3>Edit details</h3>
    <label>Title</label><input type="text" id="e-title">
    <div class="two"><div><label>Author</label><input type="text" id="e-author"></div><div><label>Series</label><input type="text" id="e-series"></div></div>
    <label>Tags (comma separated)</label><input type="text" id="e-tags">
    <label>Collections</label><div class="chips" id="e-cols"></div>
    <div class="two"><div><label>Status</label><select id="e-status" style="width:100%">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label>Rating</label><div class="rate" id="e-rate"></div></div></div>
    <label>Description</label><textarea id="e-desc" rows="4"></textarea>
    <label>Cover image</label><input type="file" id="e-cover" accept="image/*">
    <p style="color:var(--muted);font-size:12px;margin:10px 0 0">${b.format.toUpperCase()} · ${(b.size / 1048576).toFixed(1)} MB · added ${new Date(b.added).toLocaleDateString()}${b.readMs ? ' · read ' + Math.round(b.readMs / 60000) + ' min' : ''}</p>
    <div class="acts"><button data-x>Cancel</button><button class="primary" data-ok>Save</button></div>`);
  const v = (s) => d.querySelector(s);
  v('#e-title').value = b.title; v('#e-author').value = b.author || ''; v('#e-series').value = b.series || '';
  v('#e-tags').value = (b.tags || []).join(', '); v('#e-status').value = b.status; v('#e-desc').value = b.description || '';
  const drawCols = () => {
    v('#e-cols').innerHTML = S.collections.map((c) => `<button class="chip ${cols.has(c) ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('') + '<button class="chip" data-newc>＋ New</button>';
  };
  const drawRate = () => { v('#e-rate').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="${n <= rating ? 'on' : ''}" data-r="${n}">★</button>`).join(''); };
  drawCols(); drawRate();
  v('#e-cols').onclick = async (e) => {
    const c = e.target.closest('[data-c]');
    if (c) { cols.has(c.dataset.c) ? cols.delete(c.dataset.c) : cols.add(c.dataset.c); drawCols(); }
    if (e.target.closest('[data-newc]')) {
      const n = (await askText('New collection', ''))?.trim();
      if (n && !S.collections.includes(n)) { S.collections.push(n); await saveCollections(); }
      if (n) cols.add(n);
      b.collections = [...cols]; await save(b); // keep the new assignment, then re-open the dialog
      editBook(id);
    }
  };
  v('#e-rate').onclick = (e) => { const r = e.target.closest('[data-r]'); if (r) { rating = +r.dataset.r === rating ? 0 : +r.dataset.r; drawRate(); } };
  v('#e-cover').onchange = (e) => (newCover = e.target.files[0] || null);
  v('[data-x]').onclick = closeModal;
  v('[data-ok]').onclick = async () => {
    b.title = v('#e-title').value.trim() || b.title; b.author = v('#e-author').value.trim(); b.series = v('#e-series').value.trim();
    b.tags = [...new Set(v('#e-tags').value.split(',').map((t) => t.trim()).filter(Boolean))];
    b.collections = [...cols]; b.status = v('#e-status').value; b.rating = rating; b.description = v('#e-desc').value;
    if (b.status === 'finished') b.progress = 1;
    if (newCover) { b.cover = await shrink(newCover); if (coverUrls.has(b.id)) { URL.revokeObjectURL(coverUrls.get(b.id)); coverUrls.delete(b.id); } }
    await save(b); closeModal(); await refresh();
  };
}

/* ------------------------------------------------------------------ import */
async function shrink(blob) {
  if (!blob) return null;
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, 480 / bmp.height);
    const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
  } catch { return blob; }
}
async function sha(buf) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 12), (x) => x.toString(16).padStart(2, '0')).join('');
}
async function importFiles(files, quiet = false) {
  let added = 0, dup = 0, bad = 0;
  const list = [...files];
  for (const [i, f] of list.entries()) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['epub', 'pdf', 'txt'].includes(ext)) { bad++; continue; }
    if (!quiet) toast(`Importing ${i + 1} of ${list.length}: ${f.name}`, 60000);
    try {
      const buf = await f.arrayBuffer();
      const id = await sha(buf);
      if (byId(id)) { dup++; continue; }
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
      const b = { id, title: base, author: '', series: '', description: '', language: '', publisher: '', tags: [], collections: [], status: 'unread', favorite: false, rating: 0, format: ext, size: f.size, added: Date.now(), lastOpened: 0, progress: 0, pos: null, readMs: 0, cover: null };
      if (ext === 'epub') {
        const e = await openEpub(buf);
        const m = e.meta;
        b.title = m.title || base; b.author = m.author; b.series = m.series; b.description = m.description; b.language = m.language; b.publisher = m.publisher;
        b.tags = m.subjects.slice(0, 5).map((t) => t.slice(0, 30));
        b.cover = await shrink(await e.cover());
        e.dispose();
      } else if (ext === 'pdf') {
        const p = await pdfCover(buf);
        if (p.title) b.title = p.title;
        if (p.author) b.author = p.author;
        if (p.blob) b.cover = await shrink(p.blob);
        b.pages = p.pages;
      }
      await db.put('files', new Blob([buf], { type: ext === 'pdf' ? 'application/pdf' : ext === 'epub' ? 'application/epub+zip' : 'text/plain' }), id);
      b.updatedAt = 0; b.posAt = 0; // a fresh import never overrides edits made to the same book on another device
      await db.put('books', b);
      S.books.push(b);
      added++;
      render();
    } catch (err) { console.error(f.name, err); bad++; }
  }
  await refresh();
  if (!quiet) toast(`${added} added` + (dup ? `, ${dup} already in library` : '') + (bad ? `, ${bad} could not be read` : ''), 5000);
}

/* ------------------------------------------------------------------ backup */
async function exportBackup() {
  const data = { app: 'shelfwise', version: 1, exported: new Date().toISOString(), collections: S.collections,
    books: S.books.map(({ cover, ...b }) => b), highlights: await db.all('highlights'), bookmarks: await db.all('bookmarks') };
  download(`folio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1));
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'shelfwise') throw new Error('Not a Folio backup');
    let merged = 0, missing = 0;
    for (const nb of d.books) {
      const b = byId(nb.id);
      if (!b) { missing++; continue; }
      Object.assign(b, { tags: nb.tags, collections: nb.collections, status: nb.status, favorite: nb.favorite, rating: nb.rating, pos: nb.pos, progress: nb.progress, readMs: Math.max(b.readMs || 0, nb.readMs || 0), title: nb.title, author: nb.author, series: nb.series, description: nb.description });
      await save(b); merged++;
    }
    for (const h of d.highlights || []) if (byId(h.bookId)) await db.put('highlights', h);
    for (const m of d.bookmarks || []) if (byId(m.bookId)) await db.put('bookmarks', m);
    S.collections = [...new Set([...S.collections, ...(d.collections || [])])];
    await saveCollections(); await refresh();
    toast(`Restored data for ${merged} books` + (missing ? ` (${missing} books in the backup aren't in this library - add their files first, then restore again)` : ''), 7000);
  } catch (e) { toast('Restore failed: ' + e.message); }
}

/* ------------------------------------------------------------------ events */
function bind() {
  $('#nav').onclick = async (e) => {
    if (e.target.closest('#add-col')) {
      const n = (await askText('New collection', ''))?.trim();
      if (n && !S.collections.includes(n)) { S.collections.push(n); S.collections.sort(); await saveCollections(); S.filter = 'c:' + n; lsSet('sw-filter', S.filter); render(); }
      return;
    }
    const b = e.target.closest('[data-f]');
    if (b) { S.filter = b.dataset.f; lsSet('sw-filter', S.filter); S.sel.clear(); document.body.classList.remove('nav-open'); render(); }
  };
  $('#btn-nav').onclick = () => document.body.classList.toggle('nav-open');
  $('#navscrim').onclick = () => document.body.classList.remove('nav-open');
  $('#nav').oncontextmenu = (e) => {
    const b = e.target.closest('[data-f^="c:"]');
    if (!b) return;
    e.preventDefault();
    const name = b.dataset.f.slice(2);
    menu(e.clientX, e.clientY, [
      { label: 'Rename collection…', fn: async () => {
        const n = (await askText('Rename collection', name))?.trim();
        if (!n || n === name) return;
        S.collections = S.collections.map((c) => (c === name ? n : c));
        await saveCollections();
        await updateBooks(S.books.filter((x) => (x.collections || []).includes(name)).map((x) => x.id), (x) => (x.collections = x.collections.map((c) => (c === name ? n : c))));
        if (S.filter === 'c:' + name) S.filter = 'c:' + n;
        render();
      } },
      { label: 'Delete collection (keeps books)', danger: true, fn: async () => {
        S.collections = S.collections.filter((c) => c !== name); await saveCollections();
        await updateBooks(S.books.filter((x) => (x.collections || []).includes(name)).map((x) => x.id), (x) => (x.collections = x.collections.filter((c) => c !== name)));
        if (S.filter === 'c:' + name) S.filter = 'all';
        render();
      } },
    ]);
  };

  $('#search').oninput = (e) => { S.q = e.target.value; renderMain(); };
  $('#sort').onchange = (e) => { S.sort = e.target.value; lsSet('sw-sort', S.sort); renderMain(); };
  $('#viewseg').onclick = (e) => { const b = e.target.closest('[data-view]'); if (b) { S.view = b.dataset.view; lsSet('sw-view', S.view); renderMain(); } };
  $('#btn-import').onclick = () => $('#file').click();
  $('#file').onchange = (e) => { importFiles(e.target.files); e.target.value = ''; };
  $('#backupfile').onchange = (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };
  $('#btn-more').onclick = (e) => {
    const r = e.target.getBoundingClientRect();
    menu(r.left - 150, r.bottom + 4, [
      { label: 'Appearance…', fn: appearanceDialog },
      { label: sync.getCfg().provider ? `Sync… (${sync.PROVIDERS[sync.getCfg().provider]?.label}, last ${ago(sync.getCfg().lastSync)})` : 'Sync…', fn: syncDialog },
      { sep: true },
      { label: 'Export library data (backup)', fn: exportBackup },
      { label: 'Restore from backup…', fn: () => $('#backupfile').click() },
      { sep: true },
      { label: 'Select all visible  (Ctrl+A)', fn: () => { visible().forEach((b) => S.sel.add(b.id)); render(); } },
    ]);
  };

  $('#books').onclick = async (e) => {
    const del = e.target.closest('[data-delbm]');
    if (del) { await db.del('bookmarks', del.dataset.delbm); return refresh(); }
    const item = e.target.closest('.bmitem');
    if (item) { openBook(item.dataset.id, S.bm.find((m) => m.id === item.dataset.bmid) || null); return; }
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('[data-fav]')) { const b = byId(id); b.favorite = !b.favorite; save(b).then(refresh); return; }
    if (e.target.closest('[data-more]')) { const r = e.target.getBoundingClientRect(); bookMenu(id, r.left, r.bottom); return; }
    if (e.ctrlKey || e.metaKey || e.shiftKey || S.sel.size) {
      if (e.shiftKey && S.lastSel) {
        const ids = visible().map((b) => b.id);
        const [a, b2] = [ids.indexOf(S.lastSel), ids.indexOf(id)].sort((x, y) => x - y);
        ids.slice(a, b2 + 1).forEach((x) => S.sel.add(x));
      } else S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
      S.lastSel = id; render(); return;
    }
    openBook(id);
  };
  $('#books').oncontextmenu = (e) => {
    const card = e.target.closest('[data-id]');
    if (card) { e.preventDefault(); bookMenu(card.dataset.id, e.clientX, e.clientY); }
  };
  $('#selbar').onclick = async (e) => {
    const a = e.target.closest('[data-bulk]')?.dataset.bulk;
    if (!a) return;
    const ids = [...S.sel], r = e.target.getBoundingClientRect();
    if (a === 'clear') { S.sel.clear(); render(); }
    if (a === 'col') collectionMenu(ids, r.left, r.top - 160);
    if (a === 'status') statusMenu(ids, r.left, r.top - 110);
    if (a === 'del') deleteBooks(ids);
    if (a === 'tag') {
      const t = (await askText('Add tag to selected books', ''))?.trim();
      if (t) updateBooks(ids, (b) => (b.tags = [...new Set([...(b.tags || []), t])]));
    }
  };

  // drag & drop
  let depth = 0;
  addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; $('#dropzone').hidden = false; } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#dropzone').hidden = true; } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('#dropzone').hidden = true; if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

  addEventListener('keydown', (e) => {
    if (!$('#reader').hidden || !$('#modal').hidden || e.target.matches('input,textarea,select')) { if (e.key === 'Escape' && e.target.id === 'search') e.target.blur(); return; }
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'Escape') { S.sel.clear(); closePop(); render(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); visible().forEach((b) => S.sel.add(b.id)); render(); }
  });
}

bind();
sync.configure({ onChange: () => refresh(), importFile: (f) => importFiles([f], true) });
refresh().then(() => { sync.start(); upd.start(() => render()); });
