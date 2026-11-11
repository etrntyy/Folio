/* Folio self-update from the GitHub repository.
 *
 * - Checks manifest.json on the repo's main branch for a newer version (at most every 12 h; can be switched off).
 * - Web / phone app: "Update" refreshes the offline cache and reloads - the hosted copy is already current.
 * - Chrome extension loaded from a folder: Chrome cannot replace an unpacked extension's files by itself, so with
 *   your permission Folio downloads the repo files into that folder (you pick it once), then reloads itself.
 *
 * Trust note: updating means running whatever is on the repo's main branch. Only point this at a repository
 * you control or trust (REPO below).
 */
import * as db from './db.js';
import { lsGet, lsSet } from './ui.js';

export const REPO = 'etrntyy/Folio';
export const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
export const isExtension = !!globalThis.chrome?.runtime?.id;
export const repoUrl = `https://github.com/${REPO}`;
export const downloadUrl = `https://github.com/${REPO}/releases/latest`;
// An unpacked extension can only update itself where the browser lets us write to its folder (Chromium).
// Firefox cannot, so there the Update button just opens the download page.
export const canSelfUpdate = !isExtension || typeof showDirectoryPicker === 'function';

const KEY = 'sw-update';
export const getCfg = () => ({ auto: true, checkedAt: 0, latest: '', error: '', ...lsGet(KEY, {}) });
export const setCfg = (p) => lsSet(KEY, { ...getCfg(), ...p });

let current = '0';
let loaded = false; // until our own version is known, never claim an update is available
export const currentVersion = () => current;
export async function loadCurrent() {
  try {
    current = isExtension ? chrome.runtime.getManifest().version : (await (await fetch('manifest.json', { cache: 'no-store' })).json()).version;
  } catch { /* keep default */ }
  loaded = true;
  return current;
}

/** semver-ish compare: >0 if a is newer than b */
export function cmp(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
export const updateAvailable = () => loaded && cmp(getCfg().latest, current) > 0;

export async function check({ force = false } = {}) {
  const c = getCfg();
  if (!force && (!c.auto || Date.now() - c.checkedAt < 12 * 3600e3)) return c;
  try {
    const r = await fetch(`${RAW}manifest.json?t=${Math.floor(Date.now() / 6e5)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const m = await r.json();
    setCfg({ latest: String(m.version || ''), checkedAt: Date.now(), error: '' });
  } catch (e) {
    setCfg({ checkedAt: Date.now(), error: 'Could not reach GitHub (' + (e.message || e) + ').' });
  }
  return getCfg();
}

/* ---------------------------------------------------------------- applying an update */
export async function updateWebApp() {
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update();
  for (const k of await caches.keys()) await caches.delete(k);
  location.reload();
}

const safePath = (p) => !p.split('/').some((s) => !s || s === '.' || s === '..' || s.startsWith('.git')) && !/[\\:]/.test(p);

/** Pure helper: which repo files should be written into the extension folder. */
export function filesToInstall(tree) {
  return (tree || []).filter((e) => e.type === 'blob' && safePath(e.path) && e.size <= 20e6).map((e) => e.path);
}

async function writeFile(dir, path, blob) {
  const parts = path.split('/'); const name = parts.pop();
  let d = dir;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(blob); await w.close();
}

/** Downloads every file first, then writes them, so a failed download never leaves a half-updated folder. */
export async function installInto(dir, onProgress = () => {}, fetchImpl = fetch) {
  const t = await fetchImpl(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  if (!t.ok) throw new Error(`GitHub answered ${t.status}`);
  const tree = await t.json();
  if (tree.truncated) throw new Error('The repository is too large to update automatically.');
  const paths = filesToInstall(tree.tree);
  if (!paths.includes('manifest.json')) throw new Error('The repository does not look like Folio.');
  const blobs = [];
  for (const [i, p] of paths.entries()) {
    onProgress(`Downloading ${i + 1} of ${paths.length}…`);
    const r = await fetchImpl(RAW + p.split('/').map(encodeURIComponent).join('/') + `?t=${Date.now()}`);
    if (!r.ok) throw new Error(`Could not download ${p} (${r.status}).`);
    blobs.push([p, await r.blob()]);
  }
  const manifestAt = blobs.findIndex(([p]) => p === 'manifest.json');
  const last = blobs.splice(manifestAt, 1)[0];
  blobs.push(last); // manifest last: the extension only "switches version" once everything else is in place
  for (const [i, [p, b]] of blobs.entries()) { onProgress(`Installing ${i + 1} of ${blobs.length}…`); await writeFile(dir, p, b); }
  return paths.length;
}

export async function updateExtension(onProgress = () => {}) {
  let dir = await db.get('kv', 'ext-dir');
  if (dir) {
    try { if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = null; } catch { dir = null; }
  }
  if (!dir) dir = await showDirectoryPicker({ id: 'folio-ext', mode: 'readwrite' });
  let name = '';
  try { name = JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text()).name || ''; } catch { /* not a folder with a manifest */ }
  if (!/^Folio/.test(name)) throw new Error('That is not the Folio extension folder (no Folio manifest.json inside). Pick the folder you used with "Load unpacked".');
  await db.put('kv', dir, 'ext-dir');
  const n = await installInto(dir, onProgress);
  onProgress(`Updated ${n} files. Reloading…`);
  setTimeout(() => chrome.runtime.reload(), 600);
}

export async function start(onChange) {
  await loadCurrent();
  onChange?.();                       // sidebar was drawn before the version was known
  const before = updateAvailable();
  await check();
  if (updateAvailable() !== before) onChange?.();
}
