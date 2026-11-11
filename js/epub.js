import { Zip } from './zip.js';

const parser = new DOMParser();
const xml = (t) => parser.parseFromString(t.replace(/^﻿/, ''), 'application/xml');
const q = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
const safeDec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', css: 'text/css', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff',
  woff2: 'font/woff2', mp3: 'audio/mpeg', mp4: 'video/mp4', xhtml: 'application/xhtml+xml', html: 'text/html',
};
const mimeOf = (p) => MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream';

export function resolve(base, href) {
  const i = href.indexOf('#');
  const hash = i >= 0 ? safeDec(href.slice(i + 1)) : '';
  const p = i >= 0 ? href.slice(0, i) : href;
  if (!p) return { path: base, hash };
  let path;
  try { path = safeDec(new URL(p, 'http://z/' + encodeURI(base)).pathname.slice(1)); } catch { path = p; }
  return { path, hash };
}

export async function openEpub(buf) {
  const zip = new Zip(buf);
  const container = xml(await zip.text('META-INF/container.xml'));
  const opfPath = q(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('Not a valid EPUB (no package document)');
  const opf = xml(await zip.text(opfPath));

  const manifest = {};
  for (const it of q(opf, 'item')) {
    manifest[it.getAttribute('id')] = {
      id: it.getAttribute('id'),
      href: resolve(opfPath, it.getAttribute('href') || '').path,
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    };
  }
  const spineEl = q(opf, 'spine')[0];
  const spine = q(opf, 'itemref').map((r) => manifest[r.getAttribute('idref')]).filter((m) => m && zip.has(m.href))
    .map((m) => ({ ...m, size: Math.max(zip.size(m.href), 200) }));
  if (!spine.length) throw new Error('This EPUB has no readable content');

  // ---- metadata ----
  const md = q(opf, 'metadata')[0] || opf;
  const dc = (n) => q(md, n).map((e) => e.textContent.trim()).filter(Boolean);
  const metas = q(opf, 'meta');
  const metaByName = (n) => metas.find((m) => m.getAttribute('name') === n)?.getAttribute('content');
  const meta = {
    title: dc('title')[0] || '',
    author: dc('creator').join(', '),
    description: (dc('description')[0] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    language: dc('language')[0] || '',
    publisher: dc('publisher')[0] || '',
    subjects: dc('subject'),
    series: metaByName('calibre:series') || q(md, 'meta').find((m) => m.getAttribute('property') === 'belongs-to-collection')?.textContent.trim() || '',
    seriesIndex: metaByName('calibre:series_index') || '',
  };

  // ---- cover ----
  let coverItem = manifest[metaByName('cover')] || Object.values(manifest).find((m) => /cover-image/.test(m.props));
  if (!coverItem) coverItem = Object.values(manifest).find((m) => m.type.startsWith('image/') && /cover/i.test(m.id + m.href));
  const cover = async () => {
    if (!coverItem || !zip.has(coverItem.href)) return null;
    return new Blob([await zip.read(coverItem.href)], { type: coverItem.type || mimeOf(coverItem.href) });
  };

  // ---- blobs ----
  const urls = new Map();
  const blobUrl = async (path) => {
    if (urls.has(path)) return urls.get(path);
    if (!zip.has(path)) return null;
    const url = URL.createObjectURL(new Blob([await zip.read(path)], { type: mimeOf(path) }));
    urls.set(path, url);
    return url;
  };
  const cssCache = new Map();
  async function rewriteCss(css, base) {
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    const found = [...css.matchAll(re)];
    if (!found.length) return css;
    const map = new Map();
    for (const m of found) {
      const u = m[2];
      if (map.has(u) || /^(data:|https?:|#)/i.test(u)) continue;
      map.set(u, await blobUrl(resolve(base, u).path));
    }
    return css.replace(re, (m, _q, u) => (map.get(u) ? `url("${map.get(u)}")` : m));
  }
  async function cssText(path) {
    if (!cssCache.has(path)) cssCache.set(path, zip.has(path) ? await rewriteCss(await zip.text(path), path) : '');
    return cssCache.get(path);
  }

  // ---- chapters ----
  async function chapter(i) {
    const it = spine[i];
    const doc = parser.parseFromString(await zip.text(it.href), 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,base').forEach((e) => e.remove());
    for (const l of [...doc.querySelectorAll('link[rel~=stylesheet][href]')]) {
      const s = doc.createElement('style');
      s.dataset.done = '1';
      try { s.textContent = await cssText(resolve(it.href, l.getAttribute('href')).path); } catch { /* ignore */ }
      l.replaceWith(s);
    }
    for (const s of doc.querySelectorAll('style:not([data-done])')) s.textContent = await rewriteCss(s.textContent, it.href);
    for (const el of doc.querySelectorAll('[style*="url("]')) el.setAttribute('style', await rewriteCss(el.getAttribute('style'), it.href));
    for (const img of doc.querySelectorAll('img[src]')) {
      const u = await blobUrl(resolve(it.href, img.getAttribute('src')).path);
      if (u) img.setAttribute('src', u);
      img.removeAttribute('srcset');
    }
    for (const img of doc.querySelectorAll('image')) {
      const attr = img.hasAttribute('href') ? 'href' : 'xlink:href';
      const v = img.getAttribute(attr);
      if (!v) continue;
      const u = await blobUrl(resolve(it.href, v).path);
      if (u) img.setAttribute(attr, u);
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.dataset.ext = href; }
      else { const r = resolve(it.href, href); a.dataset.ipath = r.path; a.dataset.ihash = r.hash; }
      a.setAttribute('href', '#');
    }
    return doc;
  }
  const textCache = new Map();
  async function text(i) {
    if (!textCache.has(i)) {
      const d = parser.parseFromString(await zip.text(spine[i].href), 'text/html');
      d.querySelectorAll('script,style').forEach((e) => e.remove());
      textCache.set(i, (d.body?.textContent || '').replace(/\s+/g, ' ').trim());
    }
    return textCache.get(i);
  }

  const indexOfPath = (p) => spine.findIndex((s) => s.href === p || s.href.toLowerCase() === p.toLowerCase());

  // ---- table of contents ----
  let toc = [];
  try {
    const nav = Object.values(manifest).find((m) => /\bnav\b/.test(m.props));
    const ncx = manifest[spineEl?.getAttribute('toc')] || Object.values(manifest).find((m) => m.type === 'application/x-dtbncx+xml');
    if (nav && zip.has(nav.href)) {
      const d = parser.parseFromString(await zip.text(nav.href), 'text/html');
      const n = d.querySelector('nav[epub\\:type="toc"], nav[role="doc-toc"]') || d.querySelector('nav');
      const walk = (ol, depth) => {
        for (const li of ol.children) {
          const a = li.querySelector(':scope > a, :scope > span');
          if (a) {
            const href = a.getAttribute('href');
            if (href) { const r = resolve(nav.href, href); toc.push({ label: a.textContent.replace(/\s+/g, ' ').trim(), ...r, depth }); }
            else toc.push({ label: a.textContent.replace(/\s+/g, ' ').trim(), path: null, hash: '', depth });
          }
          const sub = li.querySelector(':scope > ol');
          if (sub) walk(sub, depth + 1);
        }
      };
      const ol = n?.querySelector('ol');
      if (ol) walk(ol, 0);
    }
    if (!toc.length && ncx && zip.has(ncx.href)) {
      const d = xml(await zip.text(ncx.href));
      const walk = (parent, depth) => {
        for (const np of Array.from(parent.children).filter((c) => c.localName === 'navPoint')) {
          const label = q(np, 'text')[0]?.textContent.replace(/\s+/g, ' ').trim() || '';
          const src = q(np, 'content')[0]?.getAttribute('src');
          if (src) toc.push({ label, ...resolve(ncx.href, src), depth });
          walk(np, depth + 1);
        }
      };
      const map = q(d, 'navMap')[0];
      if (map) walk(map, 0);
    }
  } catch { /* fall through to spine-based TOC */ }
  toc = toc.map((t) => ({ ...t, spine: t.path ? indexOfPath(t.path) : -1 })).filter((t) => t.label);
  if (!toc.some((t) => t.spine >= 0)) toc = spine.map((s, i) => ({ label: 'Section ' + (i + 1), spine: i, hash: '', depth: 0 }));

  return {
    kind: 'epub', meta, spine, toc, cover, chapter, text, indexOfPath,
    dispose() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}

export function openText(content, title) {
  const doc = () => {
    const d = parser.parseFromString('<!doctype html><html><head></head><body></body></html>', 'text/html');
    const paras = content.replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (const p of paras) {
      const t = p.trim();
      if (!t) continue;
      const el = d.createElement('p');
      el.textContent = t.replace(/\n/g, ' ');
      d.body.appendChild(el);
    }
    return d;
  };
  return {
    kind: 'txt', meta: { title }, spine: [{ href: 'text', size: Math.max(content.length, 200) }],
    toc: [{ label: title, spine: 0, hash: '', depth: 0 }],
    cover: async () => null, chapter: async () => doc(),
    text: async () => content.replace(/\s+/g, ' ').trim(), indexOfPath: () => 0, dispose() {},
  };
}
