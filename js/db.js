// Tiny IndexedDB wrapper. Everything stays local in the browser profile.
// Highlights/bookmarks are time-stamped on every write and deletions leave a small "tombstone",
// which is what lets cloud sync (sync.js) tell "deleted here" apart from "never existed here".
let dbp;
function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('shelfwise', 2);
    r.onupgradeneeded = (ev) => {
      const d = r.result;
      if (ev.oldVersion < 1) {
        d.createObjectStore('books', { keyPath: 'id' });
        d.createObjectStore('files');
        d.createObjectStore('highlights', { keyPath: 'id' }).createIndex('book', 'bookId');
        d.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('book', 'bookId');
        d.createObjectStore('kv');
      }
      if (ev.oldVersion < 2) d.createObjectStore('tombs'); // key "store:id" -> { store, id, at }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function store(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }

const SYNCED = ['books', 'highlights', 'bookmarks'];
const STAMPED = ['highlights', 'bookmarks'];
let onWrite = null;
export const setOnWrite = (fn) => { onWrite = fn; };

export const get = async (s, k) => wrap((await store(s)).get(k));
export const all = async (s) => wrap((await store(s)).getAll());
// opts.raw: write exactly as given (used by sync) - no stamping, and a tombstone is left alone.
export async function put(s, v, k, opts = {}) {
  if (!opts.raw && STAMPED.includes(s) && v && typeof v === 'object') v.updatedAt = Date.now();
  const r = await wrap((await store(s, 'readwrite')).put(v, k));
  if (!opts.raw && SYNCED.includes(s)) { await wrap((await store('tombs', 'readwrite')).delete(`${s}:${v.id}`)); onWrite?.(s); }
  return r;
}
export async function del(s, k, opts = {}) {
  const r = await wrap((await store(s, 'readwrite')).delete(k));
  if (!opts.raw && SYNCED.includes(s)) {
    await wrap((await store('tombs', 'readwrite')).put({ store: s, id: k, at: Date.now() }, `${s}:${k}`));
    onWrite?.(s);
  }
  return r;
}
export const putRaw = async (s, v, k) => wrap((await store(s, 'readwrite')).put(v, k));
export const byBook = async (s, bookId) => wrap((await store(s)).index('book').getAll(bookId));
export async function delByBook(s, bookId) {
  const st = await store(s, 'readwrite');
  const keys = await wrap(st.index('book').getAllKeys(bookId));
  for (const k of keys) st.delete(k);
}
