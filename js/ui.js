export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => crypto.randomUUID();
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

/* ---- app appearance: theme follows the browser unless overridden; optional accent colour ---- */
export const ACCENTS = [
  ['Blue', null], ['Purple', '#af52de'], ['Pink', '#ff2d55'], ['Red', '#ff3b30'],
  ['Orange', '#ff9500'], ['Green', '#34c759'], ['Teal', '#30b0c7'], ['Graphite', '#8e8e93'],
];
export const getAppearance = () => ({ theme: 'system', accent: null, ...lsGet('sw-app', {}) });
export function isDark() {
  const t = getAppearance().theme;
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
export function applyAppearance(onChange) {
  const { theme, accent } = getAppearance();
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
  if (accent && /^#[0-9a-f]{6}$/i.test(accent)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-fg', lum > 0.6 ? '#111111' : '#ffffff');
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-fg');
  }
  onChange?.();
}
export function setAppearance(patch, onChange) {
  lsSet('sw-app', { ...getAppearance(), ...patch });
  applyAppearance(onChange);
}

let toastTimer;
export function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

export function closePop() { $('#pop').hidden = true; $('#hlbar').hidden = true; }
// items: [{label, fn, danger}] | {sep:true} | {lbl:'text'}
export function menu(x, y, items) {
  const p = $('#pop');
  p.innerHTML = '';
  for (const it of items) {
    if (it.sep) { p.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); continue; }
    if (it.lbl) { p.insertAdjacentHTML('beforeend', `<div class="lbl">${esc(it.lbl)}</div>`); continue; }
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.dot) {
      const s = document.createElement('span');
      s.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px;vertical-align:-1px;background:${it.dot}`;
      b.prepend(s);
    }
    if (it.danger) b.className = 'danger';
    b.onclick = (e) => { e.stopPropagation(); closePop(); it.fn(); };
    p.appendChild(b);
  }
  p.hidden = false;
  const r = p.getBoundingClientRect();
  p.style.left = clamp(x, 6, innerWidth - r.width - 6) + 'px';
  p.style.top = clamp(y, 6, innerHeight - r.height - 6) + 'px';
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#pop,#hlbar,.more,.mark')) closePop(); });

export function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
export function modal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="dlg">${html}</div>`;
  m.hidden = false;
  m.onmousedown = (e) => { if (e.target === m) closeModal(); };
  return m.firstElementChild;
}
export function askText(title, value = '', { multiline = false, ok = 'Save' } = {}) {
  return new Promise((res) => {
    const d = modal(`<h3>${esc(title)}</h3>${multiline ? '<textarea rows="5"></textarea>' : '<input type="text">'}
      <div class="acts"><button data-x>Cancel</button><button class="primary" data-ok>${esc(ok)}</button></div>`);
    const inp = d.querySelector('input,textarea');
    inp.value = value; inp.focus(); inp.select?.();
    const done = (v) => { closeModal(); res(v); };
    d.querySelector('[data-x]').onclick = () => done(null);
    d.querySelector('[data-ok]').onclick = () => done(inp.value);
    inp.onkeydown = (e) => { if (e.key === 'Enter' && (!multiline || e.ctrlKey)) done(inp.value); if (e.key === 'Escape') done(null); };
  });
}
export function confirmBox(title, text, ok = 'Delete') {
  return new Promise((res) => {
    const d = modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="acts"><button data-x>Cancel</button><button class="primary danger-bg" data-ok style="background:var(--danger)">${esc(ok)}</button></div>`);
    d.querySelector('[data-x]').onclick = () => { closeModal(); res(false); };
    d.querySelector('[data-ok]').onclick = () => { closeModal(); res(true); };
  });
}
export function download(name, data, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
