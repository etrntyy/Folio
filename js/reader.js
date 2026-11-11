import * as db from './db.js';
import { openEpub, openText } from './epub.js';
import { openPdf } from './pdf.js';
import { $, $$, esc, uid, clamp, lsGet, lsSet, toast, menu, closePop, askText, download, isDark } from './ui.js';

const THEMES = {
  light: { bg: '#ffffff', fg: '#1d1d1f', link: '#0a66d6', dark: false },  // Original
  sepia: { bg: '#f8f1e3', fg: '#3b2f1e', link: '#9a5208', dark: false },  // Paper
  quiet: { bg: '#4a4a4d', fg: '#e5e5ea', link: '#8ab8ff', dark: true },   // Quiet
  dark: { bg: '#1c1c1e', fg: '#d1d1d6', link: '#6fa8ff', dark: true },    // Night
  black: { bg: '#000000', fg: '#b4b4ba', link: '#5f9bf0', dark: true },
};
const FONTS = {
  publisher: null,
  serif: '"New York", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: 'system-ui, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
};
const HL = {
  yellow: 'rgba(255,214,0,.45)', green: 'rgba(80,200,120,.42)', blue: 'rgba(80,150,255,.40)',
  pink: 'rgba(255,100,150,.40)', orange: 'rgba(255,149,0,.42)', purple: 'rgba(175,82,222,.38)',
};
// A highlight colour is either a palette name or a custom '#rrggbb' value.
const hexRgba = (h, a) => `rgba(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')},${a})`;
const hlRgba = (c) => HL[c] || (/^#[0-9a-f]{6}$/i.test(c) ? hexRgba(c, 0.42) : HL.yellow);
const hlSolid = (c) => (HL[c] ? HL[c].replace(/[\d.]+\)$/, '1)') : /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffd600');
const paint = (el, c) => { el.dataset.c = c; el.style.setProperty('background', hlRgba(c), 'important'); };
const palette = () => [...Object.keys(HL), ...(set.custom || [])];
const cname = (c) => (HL[c] ? c[0].toUpperCase() + c.slice(1) : c);
function addCustom(hex) {
  hex = hex.toLowerCase();
  if (HL[hex] || (set.custom || []).includes(hex)) return;
  set.custom = [hex, ...(set.custom || [])].slice(0, 8);
  persist();
}
const DEF = {
  theme: 'auto', // follows the app theme (which follows the browser by default)
  pen: null, lastPen: 'yellow', font: 'serif', size: 19, lh: 1.6, align: 'left', mode: 'paged', width: 680, margin: 36, spread: true,
  anim: 'off', // page-turn animation: off | slide | flip
};

let set = { ...DEF, ...lsGet('sw-reader', {}) };
let R = null; // active reader state
let onClose = () => {};
let inited = false;

const themeName = () => (set.theme === 'auto' || !THEMES[set.theme] ? (isDark() ? 'dark' : 'light') : set.theme);
export function refreshReaderTheme() { if (R) applySettings(); }
const frame = () => $('#frame');
const doc = () => frame().contentDocument;

/* ===================================================================== open / close */
/* `at`: optional bookmark ({spine, frac, page}) to open the book at instead of the saved position. */
export async function openReader(book, file, closeCb, at = null) {
  init();
  onClose = closeCb;
  $('#reader').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#r-title').textContent = book.title;
  $('#r-author').textContent = book.author || '';
  applyChrome();
  updatePenBtn();
  wakeChrome();
  R = { book, token: 0, idx: 0, page: 0, pages: 1, hl: await db.byBook('highlights', book.id), bm: await db.byBook('bookmarks', book.id), ebook: null, tick: null, saveT: null };
  $('#reader').classList.toggle('pdfmode', book.format === 'pdf');
  closePanel(); $('#setpop').hidden = true;

  if (book.format === 'pdf') {
    $('#frame').hidden = true;
    const pv = $('#pdfview');
    pv.hidden = false;
    $('#r-chap').textContent = 'Loading…';
    try {
      R.pdf = await openPdf(pv, await file.arrayBuffer(), { frac: book.pos?.frac || 0, page: at?.page || 0, onChange: pdfChanged });
      pdfChanged(R.pdf.info());
      pv.focus();
    } catch (err) {
      toast('Could not open this PDF: ' + (err.message || err));
    }
    book.lastOpened = Date.now();
    if (book.status === 'unread') book.status = 'reading';
    db.put('books', book);
  } else {
    $('#pdfview').hidden = true;
    $('#frame').hidden = false;
    const ebook = book.format === 'epub' ? await openEpub(await file.arrayBuffer()) : openText(await file.text(), book.title);
    R.ebook = ebook;
    let acc = 0;
    R.cum = ebook.spine.map((s) => { const c = acc; acc += s.size; return c; });
    R.total = acc;
    R.vp = Math.max(1, Math.round(acc / 3000)); // stable "book pages", independent of font size/layout
    renderToc();
    const pos = at && at.page == null ? { spine: at.spine, frac: at.frac } : book.pos || { spine: 0, frac: 0 };
    await loadChapter(pos.spine, { frac: pos.frac });
  }
  R.tick = setInterval(() => {
    if (document.visibilityState === 'visible' && document.hasFocus()) { R.book.readMs = (R.book.readMs || 0) + 10000; queueSave(); }
  }, 10000);
}

export async function closeReader() {
  if (!R) return;
  clearInterval(R.tick);
  await saveNow();
  R.ebook?.dispose();
  R.pdf?.dispose();
  $('#pdfview').hidden = true;
  $('#frame').srcdoc = '';
  $('#reader').hidden = true;
  closePanel(); $('#setpop').hidden = true; closePop();
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen();
  R = null;
  onClose();
}

/* ===================================================================== chapter loading */
async function loadChapter(i, opts = {}) {
  const E = R.ebook;
  i = clamp(i, 0, E.spine.length - 1);
  const token = ++R.token;
  const d = await E.chapter(i);
  if (token !== R.token) return;
  applyHl(d, R.hl.filter((h) => h.spine === i));
  const st = d.createElement('style');
  st.id = 'rd-style';
  d.head.appendChild(st);
  R.idx = i;
  const loaded = new Promise((res) => frame().addEventListener('load', res, { once: true }));
  frame().srcdoc = '<!doctype html>' + d.documentElement.outerHTML;
  await loaded;
  if (token !== R.token) return;
  attachFrame();
  relayout();
  if (opts.anchor) goAnchor(opts.anchor);
  else if (opts.end) setPos(1);
  else setPos(opts.frac || 0);
  if (R.query) markFind();
  if (opts.find) setCur(opts.find.n);
  if (opts.hlId) { const el = doc().querySelector(`mark[data-id="${opts.hlId}"]`); if (el) gotoEl(el); }
  frame().contentWindow.focus();
  updateUI();
  queueSave();
}

function attachFrame() {
  const d = doc(), w = d.defaultView;
  d.addEventListener('keydown', onKey);
  d.addEventListener('click', onFrameClick);
  d.addEventListener('mouseup', () => setTimeout(onSelection, 10));
  d.addEventListener('mousedown', closePop);
  d.addEventListener('mousemove', wakeChrome, { passive: true });
  w.addEventListener('scroll', () => { if (set.mode === 'scroll') { updateUI(); queueSave(); } }, { passive: true });
  // touch: swipe to turn pages (paged mode); long-press selection raises the highlight bar
  let t0 = null;
  d.addEventListener('touchstart', (e) => { t0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null; }, { passive: true });
  d.addEventListener('touchend', (e) => {
    if (!t0 || set.mode !== 'paged' || selInfo()) return;
    const c = e.changedTouches[0], dx = c.clientX - t0.x, dy = c.clientY - t0.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0.t < 700) { e.preventDefault?.(); dx < 0 ? next() : prev(); t0.swiped = true; blockClick = true; setTimeout(() => (blockClick = false), 350); }
  });
  d.addEventListener('selectionchange', debounce(() => { if (touchy() && R && doc() === d) onSelection(); }, 450));
  let wheelAt = 0;
  d.addEventListener('wheel', (e) => {
    if (set.mode !== 'paged' || e.ctrlKey) return;
    e.preventDefault();
    if (Date.now() - wheelAt < 260) return;
    wheelAt = Date.now();
    (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) > 0 ? next() : prev();
  }, { passive: false });
  const refit = debounce(() => { if (R && doc() === d) { relayout(true); updateUI(); } }, 150);
  d.fonts?.ready.then(refit);
  d.addEventListener('load', refit, true); // images
}

/* ===================================================================== layout */
const narrow = () => matchMedia('(max-width:760px)').matches;
const touchy = () => matchMedia('(pointer:coarse)').matches;
let blockClick = false;

function buildCss() {
  const t = THEMES[themeName()];
  const paged = set.mode === 'paged';
  const vw = frame().clientWidth, vh = frame().clientHeight;
  let pad = paged ? clamp(set.margin, 12, vw / 6) : set.margin;
  if (narrow()) pad = Math.min(pad, 22);
  const padY = narrow() ? 64 : paged ? 56 : 64;
  const cols = R.cols || 1;
  const fam = FONTS[set.font];
  let css = `
  html{background:${t.bg}!important;color-scheme:${t.dark ? 'dark' : 'light'};font-size:${set.size}px!important;-webkit-text-size-adjust:none}
  body{background:${t.bg}!important;color:${t.fg}!important;font-size:1rem!important;line-height:${set.lh}!important;margin:0!important;box-sizing:border-box!important;
    text-rendering:optimizeLegibility;overflow-wrap:break-word;${fam ? `font-family:${fam}!important;` : ''}}
  body *:not(a):not(mark){color:inherit!important;background-color:transparent!important}
  ${fam ? `body *:not(code):not(pre):not(kbd):not(samp){font-family:${fam}!important}` : ''}
  a,a *{color:${t.link}!important}
  p,li,dd,blockquote{line-height:${set.lh}!important;text-align:${set.align}!important;${set.align === 'justify' ? 'hyphens:auto;' : ''}}
  img,svg,video{max-width:100%!important;height:auto;break-inside:avoid}
  pre{white-space:pre-wrap}
  table{max-width:100%}
  ::selection{background:${t.dark ? 'rgba(111,147,255,.45)' : 'rgba(59,110,245,.3)'}}
  mark.rd-hl{color:inherit!important;border-radius:2px;cursor:pointer}
  mark.rd-find{background:#ffe066!important;color:#000!important;border-radius:2px}
  mark.rd-find.cur{background:#ff9d2e!important;box-shadow:0 0 0 2px #ff9d2e}
  `;
  if (paged) {
    css += `
    html{overflow:hidden!important;height:100%!important}
    body{padding:${padY}px ${pad}px!important;height:${vh}px!important;width:${vw}px!important;max-width:none!important;
      column-count:${cols}!important;column-gap:${2 * pad}px!important;column-fill:auto!important}
    img,svg,video{max-height:${vh - 2 * padY}px!important;object-fit:contain;width:auto;}
    h1,h2,h3,h4{break-after:avoid}`;
  } else {
    css += `
    html{overflow-x:hidden!important;overflow-y:auto!important}
    body{padding:${padY}px ${pad}px 80px!important;max-width:none!important;width:auto!important}`;
  }
  return css;
}

function sizeStage() {
  const avail = $('.rbody').clientWidth - (narrow() ? 0 : 100);
  const pad = clamp(set.margin, 12, 400);
  const one = set.width + 2 * pad;
  R.cols = set.mode === 'paged' && set.spread && avail >= 2 * one ? 2 : 1;
  const w = Math.min(avail, R.cols === 2 ? 2 * one : one);
  $('#stage').style.width = Math.min(avail, Math.max(280, w)) + 'px';
}

function relayout(keep = false) {
  const frac = keep ? curFrac() : null;
  sizeStage();
  const d = doc();
  const st = d?.getElementById('rd-style');
  if (!st) return;
  st.textContent = buildCss();
  measure();
  if (frac != null) setPos(frac);
}

function measure() {
  const de = doc().documentElement;
  const fw = frame().clientWidth;
  if (set.mode === 'paged' && fw > 0) R.pages = Math.max(1, Math.ceil((de.scrollWidth - 2) / fw));
  else R.pages = 1;
}

/* ===================================================================== position */
function curFrac() {
  const w = frame().contentWindow, de = doc().documentElement;
  if (set.mode === 'paged') {
    R.page = clamp(Math.round(de.scrollLeft / frame().clientWidth), 0, R.pages - 1);
    return R.page / R.pages;
  }
  const max = de.scrollHeight - w.innerHeight;
  return max > 4 ? clamp(de.scrollTop / max, 0, 1) : 0;
}
function setPos(f) {
  const de = doc().documentElement, w = frame().contentWindow;
  if (set.mode === 'paged') {
    R.page = clamp(Math.floor(f * R.pages + 1e-6), 0, R.pages - 1);
    de.scrollLeft = R.page * frame().clientWidth;
  } else {
    de.scrollTop = f * Math.max(0, de.scrollHeight - w.innerHeight);
  }
}
function atEnd() {
  const de = doc().documentElement;
  if (set.mode === 'paged') return R.page >= R.pages - 1;
  return de.scrollTop + frame().contentWindow.innerHeight >= de.scrollHeight - 4;
}
function atStart() { return set.mode === 'paged' ? R.page <= 0 : doc().documentElement.scrollTop <= 2; }
function overall() {
  if (R.idx === R.ebook.spine.length - 1 && atEnd() && (R.pages > 1 || set.mode === 'scroll')) return 1;
  return clamp((R.cum[R.idx] + curFrac() * R.ebook.spine[R.idx].size) / R.total, 0, 1);
}
function gotoEl(el) {
  const de = doc().documentElement;
  if (set.mode === 'paged') {
    const x = el.getBoundingClientRect().left + de.scrollLeft;
    R.page = clamp(Math.floor((x + 2) / frame().clientWidth), 0, R.pages - 1);
    de.scrollLeft = R.page * frame().clientWidth;
  } else el.scrollIntoView({ block: 'center' });
}
function goAnchor(hash) {
  const d = doc();
  const el = d.getElementById(hash) || d.getElementsByName(hash)[0];
  if (el) gotoEl(el); else setPos(0);
}

/* Turn to page index p within the chapter, optionally animated (set.anim: off | slide | flip).
   dir is +1 for forward, -1 for back. Honors the OS "reduce motion" setting. */
function turnTo(p, dir) {
  const f = frame(), de = doc().documentElement;
  const left = p * f.clientWidth;
  const mode = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : set.anim;
  const done = () => { updateUI(); queueSave(); };
  if (R.turning) clearTimeout(R.turning);
  f.style.transition = 'none'; f.style.transform = ''; f.style.opacity = '';
  R.page = p;
  if (mode === 'slide') {
    f.style.transformOrigin = 'center';
    void f.offsetWidth;
    f.style.transition = 'transform .15s ease-in, opacity .15s ease-in';
    f.style.transform = `translateX(${dir > 0 ? -7 : 7}%)`; f.style.opacity = '0';
    R.turning = setTimeout(() => {
      de.scrollLeft = left;
      f.style.transition = 'none';
      f.style.transform = `translateX(${dir > 0 ? 7 : -7}%)`;
      void f.offsetWidth;
      f.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
      f.style.transform = 'none'; f.style.opacity = '1';
      done();
      R.turning = setTimeout(() => { f.style.transition = ''; f.style.transform = ''; f.style.opacity = ''; R.turning = 0; }, 220);
    }, 150);
  } else if (mode === 'flip') {
    const persp = 'perspective(1600px) rotateY(';
    f.style.transformOrigin = dir > 0 ? 'left center' : 'right center';
    void f.offsetWidth;
    f.style.transition = 'transform .17s ease-in, opacity .17s ease-in';
    f.style.transform = persp + (dir > 0 ? -62 : 62) + 'deg)'; f.style.opacity = '.15';
    R.turning = setTimeout(() => {
      de.scrollLeft = left;
      f.style.transition = 'none';
      f.style.transformOrigin = dir > 0 ? 'right center' : 'left center';
      f.style.transform = persp + (dir > 0 ? 62 : -62) + 'deg)';
      void f.offsetWidth;
      f.style.transition = 'transform .22s ease-out, opacity .22s ease-out';
      f.style.transform = 'none'; f.style.opacity = '1';
      done();
      R.turning = setTimeout(() => { f.style.transition = ''; f.style.transform = ''; f.style.opacity = ''; R.turning = 0; }, 240);
    }, 170);
  } else {
    de.scrollLeft = left;
    done();
  }
}

function next() {
  if (!R.ebook) return;
  if (set.mode === 'paged') {
    if (R.page < R.pages - 1) turnTo(R.page + 1, 1);
    else if (R.idx < R.ebook.spine.length - 1) loadChapter(R.idx + 1, { frac: 0 });
    else { markFinished(); toast('End of book'); }
  } else {
    if (!atEnd()) frame().contentWindow.scrollBy({ top: frame().clientHeight * 0.88, behavior: 'smooth' });
    else if (R.idx < R.ebook.spine.length - 1) loadChapter(R.idx + 1, { frac: 0 });
    else { markFinished(); toast('End of book'); }
  }
}
function prev() {
  if (!R.ebook) return;
  if (set.mode === 'paged') {
    if (R.page > 0) turnTo(R.page - 1, -1);
    else if (R.idx > 0) loadChapter(R.idx - 1, { end: true });
  } else {
    if (!atStart()) frame().contentWindow.scrollBy({ top: -frame().clientHeight * 0.88, behavior: 'smooth' });
    else if (R.idx > 0) loadChapter(R.idx - 1, { end: true });
  }
}
function markFinished() { if (R.book.status !== 'finished') { R.book.status = 'finished'; R.book.progress = 1; queueSave(); } }

/* ===================================================================== progress / saving */
function pdfChanged(i) {
  if (!R?.pdf) return;
  R.pdfInfo = i;
  const pct = Math.round(i.frac * 100);
  $('#r-seek').value = Math.round(i.frac * 1000);
  $('#r-pct').textContent = pct + '%';
  $('#r-bm').classList.toggle('on', R.bm.some((b) => b.page === i.page));
  $('#r-chap').textContent = `Page ${i.page} of ${i.pages}`;
  $('#r-foot').textContent = `Page ${i.page} of ${i.pages}  ·  ${pct}%`;
  queueSave();
}
function updateUI() {
  if (!R?.ebook) return;
  const p = overall();
  $('#r-seek').value = Math.round(p * 1000);
  $('#r-pct').textContent = Math.round(p * 100) + '%';
  const cur = currentToc();
  $('#r-chap').textContent = cur ? cur.label : '';
  $$('.toc-i').forEach((b) => b.classList.toggle('cur', cur && +b.dataset.i === R.ebook.toc.indexOf(cur)));
  $('#r-bm').classList.toggle('on', R.bm.some((b) => b.spine === R.idx && Math.abs(b.frac - curFrac()) < 0.5 / Math.max(1, R.pages)));
  $('#r-foot').textContent = (cur ? cur.label + '  ·  ' : '') + `Page ${pageOf(p)} of ${R.vp}`;
}
const pageOf = (p) => clamp(Math.floor(p * R.vp) + 1, 1, R.vp);
// progress (0..1) of a highlight; older ones lack it, so derive it from the chapter's text length
async function hlProgress(h) {
  if (h.progress != null) return h.progress;
  R.tlen ||= {};
  if (R.tlen[h.spine] == null) R.tlen[h.spine] = (await R.ebook.text(h.spine)).length || 1;
  const f = clamp(h.start / R.tlen[h.spine], 0, 1);
  return clamp((R.cum[h.spine] + f * R.ebook.spine[h.spine].size) / R.total, 0, 1);
}
function currentToc() {
  let cur = null;
  for (const t of R.ebook.toc) if (t.spine >= 0 && t.spine <= R.idx) cur = t;
  return cur;
}
function queueSave() { clearTimeout(R?.saveT); if (R) R.saveT = setTimeout(saveNow, 500); }
async function saveNow() {
  if (!R) return;
  clearTimeout(R.saveT);
  const b = R.book;
  if (R.ebook && doc()?.documentElement) {
    try {
      b.pos = { spine: R.idx, frac: curFrac() };            // where to resume: always the current spot
      b.progress = Math.max(b.progress || 0, overall());    // how far you've read: never goes backwards when you flip back
      if (b.progress >= 0.995) b.status = 'finished';
      else if (b.status === 'unread' && b.progress > 0.002) b.status = 'reading';
    } catch { /* frame mid-reload */ }
  }
  if (R.pdf && R.pdfInfo) {
    const i = R.pdf.info();
    b.pos = { page: i.page, frac: i.frac };
    b.pages = i.pages;
    // finished once the last page is in view; otherwise scroll position
    b.progress = Math.max(b.progress || 0, i.page >= i.pages && i.frac > 0.985 ? 1 : i.frac);
    if (b.progress >= 0.995) b.status = 'finished';
    else if (b.status === 'unread' && b.progress > 0.002) b.status = 'reading';
  }
  b.lastOpened = b.posAt = Date.now(); // posAt = reading-position time (sync)
  await db.put('books', b);
}

/* ===================================================================== TOC / panels */
function renderToc() {
  $('#p-toc').innerHTML = R.ebook.toc.map((t, i) =>
    `<button class="toc-i" data-i="${i}" style="padding-left:${10 + t.depth * 16}px!important">${esc(t.label)}</button>`).join('');
}
function openPanel(name) {
  if (!R?.ebook && !(R?.pdf && name === 'marks')) return;
  const p = $('#panel');
  if (!p.hidden && p.dataset.tab === name) return closePanel();
  p.hidden = false; p.dataset.tab = name;
  $$('.ptabs button[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === name));
  ['toc', 'search', 'marks'].forEach((n) => ($('#p-' + n).hidden = n !== name));
  if (name === 'marks') renderMarks();
  if (name === 'search') $('#sq').focus();
  if (name === 'toc') $('.toc-i.cur')?.scrollIntoView({ block: 'center' });
}
function closePanel() { $('#panel').hidden = true; }

/* Reader chrome: toolbars fade out while reading and return on mouse movement. */
let idleT;
function toggleChrome() {
  const r = $('#reader');
  clearTimeout(idleT);
  if (r.classList.contains('idle')) wakeChrome(); else r.classList.add('idle');
}
function wakeChrome() {
  const r = $('#reader');
  r.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    if ($('#panel').hidden && $('#setpop').hidden && !document.querySelector('.rbar:hover')) r.classList.add('idle');
    else wakeChrome();
  }, 2800);
}

async function renderMarks() {
  const token = (R.marksToken = (R.marksToken || 0) + 1);
  if (R.pdf) {
    const bm = [...R.bm].sort((a, b) => (a.page || 0) - (b.page || 0));
    $('#marks-list').innerHTML = `<div class="mark-h"><span>Bookmarks (${bm.length})</span></div>` +
      (bm.map((b) => `<div class="mark-i" data-bm="${b.id}" data-page="${b.page || 0}"><b>Page ${b.page || '?'}</b><small>${Math.round(b.progress * 100)}% · ${new Date(b.created).toLocaleDateString()}</small><button class="del" data-delbm="${b.id}">✕</button></div>`).join('') || '<div class="mark-i"><small>Press B to bookmark the current page.</small></div>');
    applyMarkFilter();
    return;
  }
  const hl = [...R.hl].sort((a, b) => a.spine - b.spine || a.start - b.start);
  const bm = [...R.bm].sort((a, b) => a.spine - b.spine || a.frac - b.frac);
  const hp = await Promise.all(hl.map(hlProgress));
  if (!R || token !== R.marksToken) return;
  const tocLabel = (s) => { let c = ''; for (const t of R.ebook.toc) if (t.spine >= 0 && t.spine <= s) c = t.label; return c; };
  $('#marks-list').innerHTML = `
    <div class="mark-h"><span>Bookmarks (${bm.length})</span></div>
    ${bm.map((b) => `<div class="mark-i" data-bm="${b.id}" data-page="${pageOf(b.progress)}"><b>${esc(tocLabel(b.spine) || 'Bookmark')}</b><small>Page ${pageOf(b.progress)} · ${Math.round(b.progress * 100)}% · ${new Date(b.created).toLocaleDateString()}</small><button class="del" data-delbm="${b.id}">✕</button></div>`).join('') || '<div class="mark-i"><small>Press B to bookmark the current page.</small></div>'}
    <div class="mark-h"><span>Highlights (${hl.length})</span>${hl.length ? '<button id="exp-hl" style="font-size:11px;padding:2px 8px">Export .md</button>' : ''}</div>
    ${hl.map((h, i) => `<div class="mark-i" data-hl="${h.id}" data-page="${pageOf(hp[i])}" style="--hc:${hlSolid(h.color)}"><small>${esc(tocLabel(h.spine))} · Page ${pageOf(hp[i])}</small><div class="quote">${esc(h.text.slice(0, 220))}</div>${h.note ? `<i>Note: ${esc(h.note)}</i>` : ''}<button class="del" data-delhl="${h.id}">✕</button></div>`).join('') || '<div class="mark-i"><small>Select text in the book to highlight it.</small></div>'}`;
  applyMarkFilter();
}

// Notes-panel filter: free text plus a page, or a range of pages ("from" alone = that one page).
function applyMarkFilter() {
  const q = $('#mq').value.trim().toLowerCase();
  const a = parseInt($('#mp1').value, 10), b = parseInt($('#mp2').value, 10);
  const lo = Number.isFinite(a) ? a : Number.isFinite(b) ? b : null;
  const hi = Number.isFinite(b) ? b : Number.isFinite(a) ? a : null;
  const active = !!q || lo != null;
  let shown = 0, total = 0;
  $$('#marks-list .mark-i').forEach((m) => {
    if (m.dataset.page == null) { m.hidden = active; return; }
    total++;
    const p = +m.dataset.page;
    const ok = (!q || m.textContent.toLowerCase().includes(q)) && (lo == null || (p >= Math.min(lo, hi) && p <= Math.max(lo, hi)));
    m.hidden = !ok; if (ok) shown++;
  });
  $('#mcount').textContent = active ? `Showing ${shown} of ${total}` : '';
  $('#mclear').hidden = lo == null;
}

const MAX_HITS = 500;
const normQuery = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');

async function runSearch(raw) {
  const out = $('#sres');
  const qs = raw.trim();
  const token = (R.searchToken = (R.searchToken || 0) + 1);
  R.hits = []; R.hitIdx = -1; $('#scount').textContent = '';
  if (qs.length < 2) { clearSearch(); return; }
  R.query = qs;
  markFind();
  const ql = normQuery(qs);
  let html = '';
  out.innerHTML = '<small style="padding:8px;display:block">Searching…</small>';
  for (let i = 0; i < R.ebook.spine.length && R.hits.length < MAX_HITS; i++) {
    const text = await R.ebook.text(i);
    if (token !== R.searchToken) return;
    const low = text.toLowerCase();
    let pos = 0, n = 0;
    while ((pos = low.indexOf(ql, pos)) !== -1 && R.hits.length < MAX_HITS) {
      const a = Math.max(0, pos - 40), b = Math.min(text.length, pos + ql.length + 60);
      const snip = esc(text.slice(a, pos)) + '<mark>' + esc(text.slice(pos, pos + ql.length)) + '</mark>' + esc(text.slice(pos + ql.length, b));
      html += `<button class="res" data-k="${R.hits.length}"><small>${esc(chapterLabel(i))}</small>…${snip}…</button>`;
      R.hits.push({ spine: i, n });
      pos += ql.length; n++;
    }
  }
  const total = R.hits.length;
  out.innerHTML = html ? `<small style="padding:6px 10px;display:block">${total}${total >= MAX_HITS ? '+' : ''} result${total === 1 ? '' : 's'}</small>` + html
    : '<small style="padding:8px;display:block">No results.</small>';
  if (total) gotoHit(Math.max(0, R.hits.findIndex((h) => h.spine >= R.idx)));
}
function clearSearch() {
  R.query = ''; R.hits = []; R.hitIdx = -1;
  $('#sres').innerHTML = ''; $('#scount').textContent = '';
  clearFind();
}
function chapterLabel(i) { let c = 'Section ' + (i + 1); for (const t of R.ebook.toc) if (t.spine >= 0 && t.spine <= i) c = t.label; return c; }

function gotoHit(k) {
  if (!R.hits?.length) return;
  k = (k + R.hits.length) % R.hits.length;
  R.hitIdx = k;
  const h = R.hits[k];
  $('#scount').textContent = `${k + 1} of ${R.hits.length}`;
  $$('#sres .res').forEach((b) => b.classList.toggle('cur', +b.dataset.k === k));
  $('#sres .res.cur')?.scrollIntoView({ block: 'nearest' });
  if (h.spine === R.idx) { if (!doc().querySelector('mark.rd-find')) markFind(); setCur(h.n); updateUI(); queueSave(); }
  else loadChapter(h.spine, { find: { n: h.n } });
}

// Visible match highlighting inside the page (not saved). Works across inline tags and collapsed whitespace.
function clearFind() {
  const d = doc();
  if (!d?.body) return;
  d.querySelectorAll('mark.rd-find').forEach((m) => m.replaceWith(...m.childNodes));
  d.body.normalize();
}
function markFind() {
  clearFind();
  const q = R.query ? normQuery(R.query) : '';
  const d = doc();
  if (!q || !d?.body) return;
  // normalized text with an index map back to raw text offsets
  const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let norm = '', pos = 0, prevSpace = false, n;
  const map = [];
  while ((n = w.nextNode())) {
    nodes.push({ node: n, start: pos });
    const s = n.data;
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i])) { if (!prevSpace && norm) { norm += ' '; map.push(pos + i); prevSpace = true; } }
      else { const lc = s[i].toLowerCase(); norm += lc.length === 1 ? lc : s[i]; map.push(pos + i); prevSpace = false; }
    }
    pos += s.length;
  }
  const ranges = [];
  let at = 0;
  while ((at = norm.indexOf(q, at)) !== -1 && ranges.length < MAX_HITS) {
    ranges.push([map[at], map[at + q.length - 1] + 1]);
    at += q.length;
  }
  // wrap in reverse order so earlier offsets stay valid
  for (let m = ranges.length - 1; m >= 0; m--) {
    const [s, e] = ranges[m];
    for (let j = nodes.length - 1; j >= 0; j--) {
      const { node, start } = nodes[j];
      const len = node.data.length;
      if (start >= e || start + len <= s) continue;
      const a = Math.max(0, s - start), b = Math.min(len, e - start);
      if (a >= b || !node.data.slice(a, b).trim() && b - a < len) continue;
      const r = d.createRange();
      r.setStart(node, a); r.setEnd(node, b);
      const mk = d.createElement('mark');
      mk.className = 'rd-find'; mk.dataset.m = m;
      r.surroundContents(mk);
    }
  }
}
function setCur(n) {
  const d = doc();
  d.querySelectorAll('mark.rd-find.cur').forEach((x) => x.classList.remove('cur'));
  const els = d.querySelectorAll(`mark.rd-find[data-m="${n}"]`);
  els.forEach((x) => x.classList.add('cur'));
  if (els[0]) gotoEl(els[0]);
}

/* ===================================================================== bookmarks & highlights */
async function toggleBookmark() {
  if (R?.pdf) {
    const i = R.pdf.info();
    const ex = R.bm.find((b) => b.page === i.page);
    if (ex) { R.bm = R.bm.filter((b) => b !== ex); await db.del('bookmarks', ex.id); toast('Bookmark removed'); }
    else {
      const b = { id: uid(), bookId: R.book.id, spine: 0, frac: i.frac, page: i.page, label: `Page ${i.page}`, progress: i.frac, created: Date.now() };
      R.bm.push(b); await db.put('bookmarks', b); toast(`Bookmarked page ${i.page}`);
    }
    pdfChanged(i);
    if (!$('#panel').hidden && $('#panel').dataset.tab === 'marks') renderMarks();
    return;
  }
  if (!R?.ebook) return;
  const f = curFrac();
  const ex = R.bm.find((b) => b.spine === R.idx && Math.abs(b.frac - f) < 0.5 / Math.max(1, R.pages));
  if (ex) { R.bm = R.bm.filter((b) => b !== ex); await db.del('bookmarks', ex.id); toast('Bookmark removed'); }
  else {
    const b = { id: uid(), bookId: R.book.id, spine: R.idx, frac: f, progress: overall(), label: currentToc()?.label || '', created: Date.now() };
    R.bm.push(b); await db.put('bookmarks', b); toast('Bookmarked');
  }
  updateUI();
  if (!$('#panel').hidden && $('#panel').dataset.tab === 'marks') renderMarks();
}

function applyHl(d, list) {
  for (const h of list) {
    const parts = [];
    const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    let pos = 0, n;
    while ((n = w.nextNode())) {
      const len = n.data.length;
      if (pos + len > h.start && pos < h.end && n.data.trim()) parts.push([n, Math.max(0, h.start - pos), Math.min(len, h.end - pos)]);
      pos += len;
      if (pos >= h.end) break;
    }
    for (const [node, a, b] of parts) {
      if (a >= b) continue;
      const r = d.createRange();
      r.setStart(node, a); r.setEnd(node, b);
      const m = d.createElement('mark');
      m.className = 'rd-hl'; m.dataset.id = h.id; paint(m, h.color);
      r.surroundContents(m);
    }
  }
}
function selInfo() {
  const d = doc(), sel = d.defaultView.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const text = sel.toString().trim();
  if (!text) return null;
  const pre = d.createRange();
  pre.selectNodeContents(d.body);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { r, text, start, end: start + r.toString().length };
}
function frameXY(rect) {
  const f = frame().getBoundingClientRect();
  return { x: f.left + rect.left, y: f.top + rect.top, w: rect.width, h: rect.height };
}
function showBar(rect, html, handlers) {
  const bar = $('#hlbar');
  bar.innerHTML = html;
  bar.hidden = false;
  const { x, y, w, h } = frameXY(rect);
  const bw = bar.offsetWidth;
  bar.style.left = clamp(x + w / 2 - bw / 2, 6, innerWidth - bw - 6) + 'px';
  bar.style.top = (y > 60 ? y - bar.offsetHeight - 8 : y + h + 8) + 'px';
  bar.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) handlers(b.dataset.a, b.dataset); };
  bar.onchange = (e) => {
    const i = e.target.closest('input[type=color]');
    if (i) { addCustom(i.value); handlers('color', { c: i.value }); }
  };
}
const swatches = (cur) => palette().map((k) => `<button class="c" data-a="color" data-c="${k}" title="${cname(k)}" style="background:${hlSolid(k)};${cur === k ? 'border-color:#fff' : ''}"></button>`).join('')
  + '<label class="c plus" title="More colours…">+<input type="color" value="#ff8a00"></label>';

function setPen(color) {
  set.pen = color;
  if (color) set.lastPen = color;
  persist(); updatePenBtn();
  toast(color ? `Highlighter on (${cname(color)}): select text to highlight` : 'Highlighter off', 1800);
}
function updatePenBtn() {
  const b = $('#r-pen');
  b.classList.toggle('on', !!set.pen);
  b.style.setProperty('--pen', set.pen ? hlSolid(set.pen) : 'currentColor');
}
async function addHighlight(info, color, note = '') {
  const bl = doc().body.textContent.length || 1;
  const progress = clamp((R.cum[R.idx] + Math.min(1, info.start / bl) * R.ebook.spine[R.idx].size) / R.total, 0, 1);
  const h = { id: uid(), bookId: R.book.id, spine: R.idx, start: info.start, end: info.end, text: info.text, color, note, progress, created: Date.now() };
  R.hl.push(h); await db.put('highlights', h);
  applyHl(doc(), [h]);
  doc().defaultView.getSelection().removeAllRanges();
  if (!$('#panel').hidden && $('#panel').dataset.tab === 'marks') renderMarks();
}
function onSelection() {
  if (!R?.ebook) return;
  const info = selInfo();
  if (!info) return;
  if (set.pen) { addHighlight(info, set.pen); return; }
  showBar(info.r.getBoundingClientRect(), `${swatches()}<button data-a="note">Note</button><button data-a="copy">Copy</button>`, async (a, ds) => {
    if (a === 'copy') { navigator.clipboard.writeText(info.text); toast('Copied'); }
    else {
      let note = '';
      if (a === 'note') { note = await askText('Add a note to this highlight', '', { multiline: true }); if (note == null) return; }
      await addHighlight(info, ds.c || set.lastPen || 'yellow', note);
    }
    doc().defaultView.getSelection().removeAllRanges();
    $('#hlbar').hidden = true;
  });
}
function onFrameClick(e) {
  if (blockClick) return;
  closePop();
  const a = e.target.closest('a');
  if (a) {
    e.preventDefault();
    if (a.dataset.ext) window.open(a.dataset.ext, '_blank', 'noopener');
    else if (a.dataset.ipath != null) {
      const i = R.ebook.indexOfPath(a.dataset.ipath);
      if (i === R.idx) goAnchor(a.dataset.ihash);
      else if (i >= 0) loadChapter(i, { anchor: a.dataset.ihash });
    }
    return;
  }
  const m = e.target.closest('mark.rd-hl');
  if (m && !selInfo()) {
    const h = R.hl.find((x) => x.id === m.dataset.id);
    if (!h) return;
    showBar(m.getBoundingClientRect(), `${swatches(h.color)}<button data-a="note">${h.note ? 'Edit note' : 'Note'}</button><button data-a="del">Remove</button>`, async (act, ds) => {
      if (act === 'color') { h.color = ds.c; await db.put('highlights', h); doc().querySelectorAll(`mark[data-id="${h.id}"]`).forEach((x) => paint(x, h.color)); }
      if (act === 'note') { const n = await askText('Note', h.note || '', { multiline: true }); if (n == null) return; h.note = n; await db.put('highlights', h); }
      if (act === 'del') {
        await db.del('highlights', h.id); R.hl = R.hl.filter((x) => x !== h);
        doc().querySelectorAll(`mark[data-id="${h.id}"]`).forEach((x) => { x.replaceWith(...x.childNodes); });
        doc().body.normalize();
      }
      $('#hlbar').hidden = true;
    });
    return;
  }
  if (selInfo()) return;
  const x = e.clientX / frame().clientWidth;
  if (touchy()) {
    // taps: left/right third flips the page, middle toggles the toolbars
    if (set.mode === 'paged' && x < 0.3) prev();
    else if (set.mode === 'paged' && x > 0.7) next();
    else toggleChrome();
    return;
  }
  // mouse: left/right 15% of page flips (paged mode only)
  if (set.mode === 'paged') { if (x < 0.15) prev(); else if (x > 0.85) next(); }
}

/* ===================================================================== keyboard */
function onKey(e) {
  if (!R) return;
  if (e.target.matches?.('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  const stop = () => e.preventDefault();
  if (!R.ebook) {
    if (k === 'Escape') closeReader();
    else if (R.pdf && !e.target.closest?.('input,textarea,select')) {
      if (k === 'b' || k === 'B') toggleBookmark();
      else if (k === 'm' || k === 'M') openPanel('marks');
      else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); R.pdf.pageStep(1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); R.pdf.pageStep(-1); }
      else if (k === 'Home') { e.preventDefault(); R.pdf.goFrac(0); }
      else if (k === 'End') { e.preventDefault(); R.pdf.goFrac(1); }
    }
    return;
  }
  if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { stop(); next(); }
  else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { stop(); prev(); }
  else if (k === 'Home') { stop(); loadChapter(0, { frac: 0 }); }
  else if (k === 'End') { stop(); loadChapter(R.ebook.spine.length - 1, { end: true }); }
  else if (k === 'Escape') { if (!$('#panel').hidden) closePanel(); else if (!$('#setpop').hidden) $('#setpop').hidden = true; else closeReader(); }
  else if (k === 't') { stop(); openPanel('toc'); }
  else if (k === 'f' || k === '/') { stop(); openPanel('search'); }
  else if (k === 'm') { stop(); openPanel('marks'); }
  else if (k === 'b') { stop(); toggleBookmark(); }
  else if (k === 'h') { stop(); setPen(set.pen ? null : set.lastPen || 'yellow'); }
  else if ((k === 'n' || k === 'N') && R.hits?.length) { stop(); gotoHit(R.hitIdx + (k === 'N' ? -1 : 1)); }
  else if (k === '+' || k === '=') { stop(); change('size', 1, 12, 36); }
  else if (k === '-') { stop(); change('size', -1, 12, 36); }
  else if (k === 'ArrowDown' && set.mode === 'paged') { stop(); next(); }
  else if (k === 'ArrowUp' && set.mode === 'paged') { stop(); prev(); }
}

/* ===================================================================== settings */
function persist() { lsSet('sw-reader', set); }
function change(key, delta, lo, hi) {
  set[key] = +clamp(+(set[key] + delta).toFixed(2), lo, hi).toFixed(2);
  persist(); applySettings(); renderSet();
}
function applyChrome() { $('#reader').dataset.theme = themeName(); }
function applySettings() {
  applyChrome();
  if (R?.ebook && doc()?.getElementById('rd-style')) { relayout(true); updateUI(); }
}
function renderSet() {
  const opt = (key, val, label) => `<button data-set="${key}" data-val="${val}" class="${String(set[key]) === String(val) ? 'on' : ''}">${label}</button>`;
  const step = (key, label, lo, hi, d) => `<div class="sg"><span>${label}</span><div class="opts"><button data-step="${key}" data-d="${-d}" data-lo="${lo}" data-hi="${hi}">−</button><span style="min-width:44px;text-align:center">${set[key]}</span><button data-step="${key}" data-d="${d}" data-lo="${lo}" data-hi="${hi}">+</button></div></div>`;
  $('#setpop').innerHTML = `
    <div class="sg"><span>Theme</span><div class="opts themes">${opt('theme', 'auto', 'Auto')}${Object.entries(THEMES).map(([k, t]) => `<button class="sw ${set.theme === k ? 'on' : ''}" data-set="theme" data-val="${k}" title="${k}" style="background:${t.bg}"></button>`).join('')}</div></div>
    <div class="sg"><span>Font</span><div class="opts">${opt('font', 'publisher', 'Book')}${opt('font', 'serif', 'Serif')}${opt('font', 'sans', 'Sans')}${opt('font', 'mono', 'Mono')}</div></div>
    ${step('size', 'Text size', 12, 36, 1)}
    ${step('lh', 'Line spacing', 1.2, 2.2, 0.1)}
    ${step('width', 'Text width', 360, 1100, 40)}
    ${step('margin', 'Margins', 12, 120, 8)}
    <div class="sg"><span>Alignment</span><div class="opts">${opt('align', 'left', 'Left')}${opt('align', 'justify', 'Justify')}</div></div>
    <div class="sg"><span>Layout</span><div class="opts">${opt('mode', 'paged', 'Pages')}${opt('mode', 'scroll', 'Scroll')}</div></div>
    <div class="sg"><span>Two pages</span><div class="opts">${opt('spread', 'true', 'Auto')}${opt('spread', 'false', 'Off')}</div></div>
    ${set.mode === 'paged' ? `<div class="sg"><span>Page turn</span><div class="opts">${opt('anim', 'off', 'None')}${opt('anim', 'slide', 'Slide')}${opt('anim', 'flip', 'Flip')}</div></div>` : ''}`;
}

/* ===================================================================== wiring */
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function init() {
  if (inited) return;
  inited = true;
  $('#r-back').onclick = closeReader;
  $('#r-prev').onclick = prev;
  $('#r-next').onclick = next;
  $('#r-fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  $('#r-bm').onclick = toggleBookmark;
  $('#p-close').onclick = closePanel;
  $$('[data-panel]').forEach((b) => (b.onclick = () => openPanel(b.dataset.panel)));
  $('#r-set').onclick = () => { const p = $('#setpop'); renderSet(); p.hidden = !p.hidden; };
  document.addEventListener('keydown', (e) => { if (!$('#reader').hidden) { wakeChrome(); onKey(e); } });
  $('#reader').addEventListener('mousemove', wakeChrome, { passive: true });
  window.addEventListener('resize', debounce(() => { if (R?.ebook && doc()?.getElementById('rd-style')) { relayout(true); updateUI(); } }, 150));
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#setpop,#r-set')) $('#setpop').hidden = true; });

  $('#setpop').onclick = (e) => {
    const s = e.target.closest('[data-set]'), st = e.target.closest('[data-step]');
    if (s) { const v = s.dataset.val; set[s.dataset.set] = v === 'true' ? true : v === 'false' ? false : v; persist(); applySettings(); renderSet(); }
    if (st) change(st.dataset.step, +st.dataset.d, +st.dataset.lo, +st.dataset.hi);
  };
  $('#p-toc').onclick = (e) => {
    const b = e.target.closest('.toc-i'); if (!b) return;
    const t = R.ebook.toc[+b.dataset.i];
    if (t.spine < 0) return;
    if (t.spine === R.idx && t.hash) goAnchor(t.hash);
    else loadChapter(t.spine, t.hash ? { anchor: t.hash } : { frac: 0 });
    updateUI();
  };
  $('#sform').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#sq').value.trim();
    if (R.query === v && R.hits?.length) gotoHit(R.hitIdx + (e.submitter?.id === 's-prev' ? -1 : 1));
    else runSearch(v);
  };
  $('#sq').oninput = () => { if (!$('#sq').value.trim()) clearSearch(); };
  $('#sq').onkeydown = (e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); if (R.hits?.length) gotoHit(R.hitIdx - 1); } };
  $('#s-next').onclick = () => { const v = $('#sq').value.trim(); if (R.query === v && R.hits?.length) gotoHit(R.hitIdx + 1); else runSearch(v); };
  $('#s-prev').onclick = () => { if (R.hits?.length) gotoHit(R.hitIdx - 1); };
  $('#sres').onclick = (e) => { const b = e.target.closest('.res'); if (b) gotoHit(+b.dataset.k); };
  $('#mq').oninput = $('#mp1').oninput = $('#mp2').oninput = applyMarkFilter;
  $('#mclear').onclick = () => { $('#mp1').value = ''; $('#mp2').value = ''; applyMarkFilter(); };
  $('#r-pen').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left - 60, r.bottom + 4, [
      { lbl: 'Highlighter' },
      { label: (set.pen ? '' : '✓ ') + 'Off', fn: () => setPen(null) },
      ...palette().map((c) => ({ label: (set.pen === c ? '✓ ' : '') + cname(c), dot: hlSolid(c), fn: () => setPen(c) })),
      { sep: true },
      { label: 'More colours…', fn: () => $('#penpick').click() },
    ]);
  };
  $('#penpick').onchange = (e) => { addCustom(e.target.value); setPen(e.target.value.toLowerCase()); };
  $('#p-marks').onclick = async (e) => {
    const dbm = e.target.closest('[data-delbm]'), dhl = e.target.closest('[data-delhl]');
    if (dbm) { const id = dbm.dataset.delbm; R.bm = R.bm.filter((b) => b.id !== id); await db.del('bookmarks', id); renderMarks(); R.pdf ? pdfChanged(R.pdf.info()) : updateUI(); return; }
    if (R.pdf) { const bm = e.target.closest('[data-bm]'); const b = bm && R.bm.find((x) => x.id === bm.dataset.bm); if (b) R.pdf.goPage(b.page); return; }
    if (dhl) {
      const id = dhl.dataset.delhl; R.hl = R.hl.filter((h) => h.id !== id); await db.del('highlights', id);
      doc().querySelectorAll(`mark[data-id="${id}"]`).forEach((x) => x.replaceWith(...x.childNodes)); renderMarks(); return;
    }
    if (e.target.id === 'exp-hl') return exportHighlights();
    const bm = e.target.closest('[data-bm]'), hl = e.target.closest('[data-hl]');
    if (bm) { const b = R.bm.find((x) => x.id === bm.dataset.bm); if (b.spine === R.idx) { setPos(b.frac); updateUI(); } else loadChapter(b.spine, { frac: b.frac }); }
    if (hl) { const h = R.hl.find((x) => x.id === hl.dataset.hl); if (h.spine === R.idx) { const el = doc().querySelector(`mark[data-id="${h.id}"]`); if (el) gotoEl(el); updateUI(); } else loadChapter(h.spine, { hlId: h.id }); }
  };
  const seek = $('#r-seek');
  seek.oninput = () => ($('#r-pct').textContent = Math.round(seek.value / 10) + '%');
  seek.onchange = () => {
    if (R.pdf) { R.pdf.goFrac(seek.value / 1000); seek.blur(); R.pdfInfo && queueSave(); return; }
    const target = (seek.value / 1000) * R.total;
    let i = R.cum.length - 1;
    while (i > 0 && R.cum[i] > target) i--;
    const frac = clamp((target - R.cum[i]) / R.ebook.spine[i].size, 0, 1);
    if (i === R.idx) { setPos(frac); updateUI(); queueSave(); } else loadChapter(i, { frac });
    seek.blur();
  };
}

function exportHighlights() {
  const lines = [`# ${R.book.title}`, R.book.author ? `*${R.book.author}*` : '', ''];
  for (const h of [...R.hl].sort((a, b) => a.spine - b.spine || a.start - b.start)) {
    lines.push(`> ${h.text.replace(/\n+/g, ' ')}`, '');
    if (h.note) lines.push(`**Note:** ${h.note}`, '');
    lines.push(`(${chapterLabel(h.spine)})`, '');
  }
  download(`${R.book.title.replace(/[^\w\- ]+/g, '').trim() || 'highlights'} - highlights.md`, lines.join('\n'), 'text/markdown');
}
