// Minimal ZIP reader using the browser's native DecompressionStream (no dependencies).
export class Zip {
  constructor(buf) {
    this.buf = buf;
    this.view = new DataView(buf);
    this.entries = new Map();
    this.lower = new Map();
    this._parse();
  }
  _parse() {
    const v = this.view;
    let i = this.buf.byteLength - 22;
    const min = Math.max(0, i - 65557);
    for (; i >= min; i--) if (v.getUint32(i, true) === 0x06054b50) break;
    if (i < min) throw new Error('Not a valid ZIP/EPUB file');
    const count = v.getUint16(i + 10, true);
    let off = v.getUint32(i + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (v.getUint32(off, true) !== 0x02014b50) break;
      const method = v.getUint16(off + 10, true);
      const csize = v.getUint32(off + 20, true);
      const usize = v.getUint32(off + 24, true);
      const nl = v.getUint16(off + 28, true);
      const el = v.getUint16(off + 30, true);
      const cl = v.getUint16(off + 32, true);
      const lho = v.getUint32(off + 42, true);
      const name = dec.decode(new Uint8Array(this.buf, off + 46, nl));
      this.entries.set(name, { name, method, csize, usize, lho });
      this.lower.set(name.toLowerCase(), name);
      off += 46 + nl + el + cl;
    }
  }
  find(name) {
    if (this.entries.has(name)) return name;
    return this.lower.get(name.toLowerCase()) || null;
  }
  has(name) { return !!this.find(name); }
  size(name) { const n = this.find(name); return n ? this.entries.get(n).usize : 0; }
  async read(name) {
    const real = this.find(name);
    if (!real) throw new Error('Missing entry: ' + name);
    const e = this.entries.get(real);
    const v = this.view;
    const nl = v.getUint16(e.lho + 26, true);
    const el = v.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + nl + el;
    const data = new Uint8Array(this.buf, start, e.csize);
    if (e.method === 0) return data.slice();
    if (e.method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('Unsupported compression method ' + e.method);
  }
  async text(name) { return new TextDecoder().decode(await this.read(name)); }
}
