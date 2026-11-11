/* Minimal continuous-scroll PDF viewer on top of the bundled pdf.js (lib/). */
let libP;
function loadLib() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return (libP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../lib/pdf.min.js', import.meta.url).href;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.js', import.meta.url).href;
      res(window.pdfjsLib);
    };
    s.onerror = () => rej(new Error('Could not load pdf.js'));
    document.head.appendChild(s);
  }));
}

/* First page as a JPEG blob plus the document's title/author metadata. Never throws. */
export function pdfCover(buf, width = 420) {
  const none = { blob: null, title: '', author: '' };
  return Promise.race([makeCover(buf, width), new Promise((r) => setTimeout(() => r(none), 20000))]);
}
async function makeCover(buf, width) {
  try {
    const lib = await loadLib();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const page = await pdf.getPage(1);
    const v0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / v0.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    let meta = {};
    try { meta = (await pdf.getMetadata()).info || {}; } catch { /* optional */ }
    const pages = pdf.numPages;
    pdf.destroy();
    return { blob, title: (meta.Title || '').trim(), author: (meta.Author || '').trim(), pages };
  } catch { return { blob: null, title: '', author: '' }; }
}

/* box: scroll container element. onChange({page, pages, frac}) fires on scroll. */
export async function openPdf(box, buf, { frac = 0, page = 0, onChange } = {}) {
  const lib = await loadLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const n = pdf.numPages;
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  box.innerHTML = '';
  const holder = document.createElement('div');
  holder.className = 'pdf-pages';
  box.appendChild(holder);

  let width = 800, gen = 0, disposed = false;
  const pages = [];
  const dpr = () => window.devicePixelRatio || 1;

  function size(i, vp0) { // set placeholder size for page i from its unscaled viewport
    const h = Math.round(width * (vp0.height / vp0.width));
    pages[i].el.style.width = width + 'px';
    pages[i].el.style.height = h + 'px';
  }
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'pdf-page'; el.dataset.p = i + 1;
    holder.appendChild(el);
    pages.push({ el, vp0: base, done: -1 });
  }

  async function render(i) {
    const p = pages[i], g = gen;
    if (p.busy || p.done === g) return;
    p.busy = true;
    try {
      const page = await pdf.getPage(i + 1);
      if (disposed || g !== gen) return;
      const vp0 = page.getViewport({ scale: 1 });
      p.vp0 = vp0; size(i, vp0);
      const scale = width / vp0.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      const r = dpr();
      canvas.width = Math.floor(vp.width * r); canvas.height = Math.floor(vp.height * r);
      canvas.style.width = '100%'; canvas.style.height = '100%';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: r !== 1 ? [r, 0, 0, r, 0, 0] : null }).promise;
      if (disposed || g !== gen) return;
      const tl = document.createElement('div');
      tl.className = 'textLayer';
      tl.style.setProperty('--scale-factor', scale);
      p.el.replaceChildren(canvas, tl);
      p.done = g;
      try {
        await lib.renderTextLayer({ textContentSource: await page.getTextContent(), container: tl, viewport: vp, textDivs: [] }).promise;
      } catch { /* text layer is optional */ }
    } catch { /* cancelled/disposed */ } finally { p.busy = false; }
  }

  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) render(+e.target.dataset.p - 1);
  }, { root: box, rootMargin: '1200px 0px' });
  pages.forEach((p) => io.observe(p.el));

  function layout() {
    gen++;
    const gutter = box.clientWidth <= 760 ? 12 : 48;
    width = Math.max(240, Math.min(920, box.clientWidth - gutter));
    pages.forEach((p, i) => { size(i, p.vp0); p.done = -1; p.el.replaceChildren(); });
    // re-trigger observer callbacks for the visible pages
    pages.forEach((p) => { io.unobserve(p.el); io.observe(p.el); });
  }

  const maxScroll = () => Math.max(1, box.scrollHeight - box.clientHeight);
  const curFrac = () => Math.min(1, Math.max(0, box.scrollTop / maxScroll()));
  function curPage() {
    const b = box.getBoundingClientRect();
    const y = b.top + box.clientHeight * 0.35;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pages[m].el.getBoundingClientRect().top <= y) lo = m; else hi = m - 1; }
    return lo + 1;
  }
  const info = () => ({ page: curPage(), pages: n, frac: curFrac() });
  let raf = 0;
  const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => onChange?.(info())); };
  box.addEventListener('scroll', onScroll, { passive: true });
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { const f = curFrac(); layout(); box.scrollTop = f * maxScroll(); onChange?.(info()); }, 150); };
  window.addEventListener('resize', onResize);

  layout();
  // restore position; heights settle as pages render, so re-apply briefly
  const target = frac;
  const place = () => {
    if (page) { const el = pages[Math.min(n, Math.max(1, page)) - 1].el; box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8; }
    else box.scrollTop = target * maxScroll();
  };
  place();
  let tries = 0;
  const settle = setInterval(() => {
    if (disposed || ++tries > 8) return clearInterval(settle);
    if (box.dataset.moved) return clearInterval(settle);
    place();
  }, 150);
  const moved = () => { box.dataset.moved = '1'; };
  box.addEventListener('wheel', moved, { once: true, passive: true });
  box.addEventListener('keydown', moved, { once: true });
  box.addEventListener('mousedown', moved, { once: true });
  delete box.dataset.moved;
  onChange?.(info());

  return {
    pages: n,
    info,
    goFrac(f) { box.scrollTop = Math.min(1, Math.max(0, f)) * maxScroll(); },
    goPage(p) { const el = pages[Math.min(n, Math.max(1, p)) - 1].el; box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8; },
    pageStep(d) { this.goPage(curPage() + d); },
    dispose() {
      disposed = true; io.disconnect(); clearInterval(settle);
      box.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize);
      box.innerHTML = ''; pdf.destroy();
    },
  };
}
