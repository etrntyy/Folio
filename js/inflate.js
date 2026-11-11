/* Pure JavaScript inflate (raw DEFLATE, RFC 1951). Used as a fallback when the browser has no
 * DecompressionStream('deflate-raw') (for example iOS before 16.4) or it fails on a file.
 * Based on the classic canonical-Huffman "tiny inflate" approach: small, dependency free, a few MB/s. */

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildTree(lengths, n) {
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(Math.max(n, 1));
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  for (let i = 0; i < 15; i++) offs[i + 1] = offs[i] + count[i];
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

let fixedL, fixedD;
function fixedTrees() {
  if (!fixedL) {
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    fixedL = buildTree(l, 288);
    fixedD = buildTree(new Uint8Array(30).fill(5), 30);
  }
  return [fixedL, fixedD];
}

/** src: Uint8Array of raw deflate data. sizeHint: expected output size (optional). Returns Uint8Array. */
export function inflateRaw(src, sizeHint = 0) {
  let pos = 0, bitbuf = 0, bitcnt = 0;
  let out = new Uint8Array(sizeHint > 0 ? sizeHint : Math.max(1024, src.length * 4)), op = 0;

  const bit = () => {
    if (!bitcnt) {
      if (pos >= src.length) throw new Error('inflate: unexpected end of data');
      bitbuf = src[pos++]; bitcnt = 8;
    }
    const b = bitbuf & 1; bitbuf >>= 1; bitcnt--;
    return b;
  };
  const bits = (n, base = 0) => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= bit() << i;
    return v + base;
  };
  const decode = (t) => {
    let sum = 0, cur = 0, len = 0;
    do {
      cur = 2 * cur + bit(); len++;
      if (len > 15) throw new Error('inflate: bad code');
      sum += t.count[len]; cur -= t.count[len];
    } while (cur >= 0);
    return t.symbol[sum + cur];
  };
  const room = (n) => {
    if (op + n <= out.length) return;
    let size = out.length * 2;
    while (size < op + n) size *= 2;
    const bigger = new Uint8Array(size); bigger.set(out.subarray(0, op)); out = bigger;
  };

  const codes = (lt, dt) => {
    for (;;) {
      let sym = decode(lt);
      if (sym < 256) { room(1); out[op++] = sym; continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw new Error('inflate: bad length symbol');
      const length = bits(LEXT[sym], LBASE[sym]);
      const ds = decode(dt);
      if (ds >= 30) throw new Error('inflate: bad distance symbol');
      const dist = bits(DEXT[ds], DBASE[ds]);
      if (dist > op) throw new Error('inflate: distance too far back');
      room(length);
      for (let i = 0; i < length; i++) { out[op] = out[op - dist]; op++; }
    }
  };

  let final;
  do {
    final = bit();
    const type = bits(2);
    if (type === 0) {                       // stored
      bitcnt = 0;                           // discard the rest of the current byte
      if (pos + 4 > src.length) throw new Error('inflate: truncated stored block');
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;                             // LEN + NLEN
      if (pos + len > src.length) throw new Error('inflate: truncated stored block');
      room(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
    } else if (type === 1) {                // fixed Huffman
      const [lt, dt] = fixedTrees();
      codes(lt, dt);
    } else if (type === 2) {                // dynamic Huffman
      const hlit = bits(5, 257), hdist = bits(5, 1), hclen = bits(4, 4);
      const lengths = new Uint8Array(320);
      for (let i = 0; i < hclen; i++) lengths[CLORDER[i]] = bits(3);
      const ct = buildTree(lengths, 19);
      let num = 0;
      while (num < hlit + hdist) {
        const sym = decode(ct);
        if (sym < 16) lengths[num++] = sym;
        else {
          let prev = 0, rep;
          if (sym === 16) { if (!num) throw new Error('inflate: bad repeat'); prev = lengths[num - 1]; rep = bits(2, 3); }
          else if (sym === 17) rep = bits(3, 3);
          else rep = bits(7, 11);
          if (num + rep > hlit + hdist) throw new Error('inflate: bad repeat length');
          while (rep--) lengths[num++] = prev;
        }
      }
      codes(buildTree(lengths, hlit), buildTree(lengths.subarray(hlit), hdist));
    } else throw new Error('inflate: bad block type');
  } while (!final);

  return op === out.length ? out : out.slice(0, op);
}
