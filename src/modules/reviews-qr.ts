// Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction L or M, versions 1 to 15.
// Enough for a wa.me link or a Google review link. Returns a square matrix, true = dark module.
// Structure follows Project Nayuki's reference QR generator (MIT).

export type Ecl = "L" | "M";

const MAX_VERSION = 15;
// Index 0 unused. Values per version 1..15.
const ECC_PER_BLOCK: Record<Ecl, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24],
};
const NUM_BLOCKS: Record<Ecl, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10],
};
const FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0 };

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const dataCodewords = (ver: number, ecl: Ecl) =>
  Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, factor)));
  }
  return r;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.floor((ver * 4 + n * 2 + 1) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function encodeData(bytes: number[], ecl: Ecl): { ver: number; codewords: number[] } {
  for (let ver = 1; ver <= MAX_VERSION; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    const cap = dataCodewords(ver, ecl) * 8;
    const used = 4 + countBits + bytes.length * 8;
    if (used > cap) continue;
    const bits: number[] = [];
    const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, countBits);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, cap - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    const codewords: number[] = [];
    for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    return { ver, codewords };
  }
  throw new Error("Text too long for a QR code. Shorten the message.");
}

function addEcc(data: number[], ver: number, ecl: Ecl): number[] {
  const numBlocks = NUM_BLOCKS[ecl][ver];
  const eccLen = ECC_PER_BLOCK[ecl][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]); });
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matrix {
  size: number;
  m: boolean[][];
  fn: boolean[][];
  constructor(public ver: number, public ecl: Ecl) {
    this.size = ver * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, dark: boolean) { this.m[y][x] = dark; this.fn[y][x] = true; }

  drawFunctionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(s - 4, 3); this.finder(3, s - 4);
    const pos = alignmentPositions(this.ver);
    const n = pos.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) this.set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    this.formatBits(0);
    this.versionBits();
  }
  finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, d !== 2 && d !== 4);
      }
  }
  formatBits(mask: number) {
    const data = (FORMAT_BITS[this.ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6)); this.set(8, 8, bit(bits, 7)); this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(bits, i));
    this.set(8, s - 8, true);
  }
  versionBits() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3), b = Math.floor(i / 3);
      this.set(a, b, bit(bits, i)); this.set(b, a, bit(bits, i));
    }
  }
  drawCodewords(data: number[]) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          if (!this.fn[y][x] && i < data.length * 8) { this.m[y][x] = bit(data[i >>> 3], 7 - (i & 7)); i++; }
        }
    }
  }
  applyMask(mask: number) {
    const f = MASKS[mask];
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) if (!this.fn[y][x] && f(x, y)) this.m[y][x] = !this.m[y][x];
  }
  /** Simplified penalty (runs, 2x2 blocks, dark balance). Any mask decodes; this only picks a cleaner one. */
  penalty(): number {
    const s = this.size, m = this.m;
    let p = 0, dark = 0;
    const runs = (get: (a: number, b: number) => boolean) => {
      for (let a = 0; a < s; a++) {
        let len = 1;
        for (let b = 1; b <= s; b++) {
          if (b < s && get(a, b) === get(a, b - 1)) len++;
          else { if (len >= 5) p += 3 + (len - 5); len = 1; }
        }
      }
    };
    runs((y, x) => m[y][x]);
    runs((x, y) => m[y][x]);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (m[y][x]) dark++;
        if (x < s - 1 && y < s - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
    const total = s * s;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }
}

/** Encode text as a QR matrix. Pass `mask` to force a mask (used by tests). */
export function qrMatrix(text: string, ecl: Ecl = "M", mask?: number): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const { ver, codewords } = encodeData(bytes, ecl);
  const q = new Matrix(ver, ecl);
  q.drawFunctionPatterns();
  q.drawCodewords(addEcc(codewords, ver, ecl));
  let best = mask ?? 0;
  if (mask == null) {
    let min = Infinity;
    for (let k = 0; k < 8; k++) {
      q.applyMask(k); q.formatBits(k);
      const pen = q.penalty();
      if (pen < min) { min = pen; best = k; }
      q.applyMask(k);
    }
  }
  q.applyMask(best);
  q.formatBits(best);
  return q.m;
}

/** SVG path data ("M x y h1 v1 h-1 z" per dark module) for a matrix with a quiet zone of `border` modules. */
export function qrPath(m: boolean[][], border = 4): string {
  let d = "";
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + border} ${y + border}h1v1h-1z`; }));
  return d;
}
