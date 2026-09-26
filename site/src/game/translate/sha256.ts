// sha256.ts — a STREAMING SHA-256, because the weights are far too big to hold.
//
// Why this file exists instead of `crypto.subtle.digest`: the WebCrypto digest
// takes a whole buffer. Verifying a 603 MB model that way means 603 MB resident
// on a phone — the exact thing the bundled translator must not do. This is the
// plain algorithm, fed one chunk at a time, so verification costs ONE chunk of
// memory no matter how large the model is.
//
// It is also the reason integrity can be checked at all on a phone: the download
// hashes each chunk as it lands in Cache Storage, and the final pass re-reads the
// stored chunks in order (still streaming) to compare against the manifest's
// pinned sha256. `translate-tests` cross-checks this implementation against
// node:crypto's, so a wrong hash cannot pass as a verdict.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

const HEX = "0123456789abcdef";

export class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private block = new Uint8Array(64);
  private blockLen = 0;
  private bytes = 0;
  private words = new Uint32Array(64);

  /** Feed the next slice. Order matters: this is a hash of the whole stream. */
  update(data: Uint8Array): this {
    this.bytes += data.length;
    let off = 0;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, data.length);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      off = take;
      if (this.blockLen === 64) {
        this.compress(this.block);
        this.blockLen = 0;
      }
    }
    while (off + 64 <= data.length) {
      this.compress(data.subarray(off, off + 64));
      off += 64;
    }
    if (off < data.length) {
      this.block.set(data.subarray(off), 0);
      this.blockLen = data.length - off;
    }
    return this;
  }

  /** The digest, WITHOUT disturbing the running state (keep updating afterwards). */
  digestBytes(): Uint8Array {
    const h = this.h.slice();
    const block = this.block.slice();
    let blockLen = this.blockLen;
    const bitLen = BigInt(this.bytes) * 8n;
    block[blockLen++] = 0x80;
    if (blockLen > 56) {
      for (let i = blockLen; i < 64; i++) block[i] = 0;
      compressInto(h, block, this.words);
      blockLen = 0;
    }
    for (let i = blockLen; i < 56; i++) block[i] = 0;
    const view = new DataView(block.buffer, block.byteOffset, 64);
    view.setBigUint64(56, bitLen);
    compressInto(h, block, this.words);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, h[i] ?? 0);
    return out;
  }

  digestHex(): string {
    const bytes = this.digestBytes();
    let out = "";
    for (const b of bytes) out += (HEX[b >> 4] ?? "0") + (HEX[b & 15] ?? "0");
    return out;
  }

  private compress(chunk: Uint8Array): void {
    compressInto(this.h, chunk, this.words);
  }
}

function compressInto(h: Uint32Array, chunk: Uint8Array, w: Uint32Array): void {
  for (let i = 0; i < 16; i++) {
    const o = i * 4;
    w[i] = (((chunk[o] ?? 0) << 24) | ((chunk[o + 1] ?? 0) << 16) | ((chunk[o + 2] ?? 0) << 8) | (chunk[o + 3] ?? 0)) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15] ?? 0;
    const y = w[i - 2] ?? 0;
    const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
    const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
    w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
  }
  let a = h[0] ?? 0;
  let b = h[1] ?? 0;
  let c = h[2] ?? 0;
  let d = h[3] ?? 0;
  let e = h[4] ?? 0;
  let f = h[5] ?? 0;
  let g = h[6] ?? 0;
  let hh = h[7] ?? 0;
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  h[0] = ((h[0] ?? 0) + a) >>> 0;
  h[1] = ((h[1] ?? 0) + b) >>> 0;
  h[2] = ((h[2] ?? 0) + c) >>> 0;
  h[3] = ((h[3] ?? 0) + d) >>> 0;
  h[4] = ((h[4] ?? 0) + e) >>> 0;
  h[5] = ((h[5] ?? 0) + f) >>> 0;
  h[6] = ((h[6] ?? 0) + g) >>> 0;
  h[7] = ((h[7] ?? 0) + hh) >>> 0;
}

/** One-shot over a whole buffer (small inputs only — chunks, receipts, tests). */
export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Sha256().update(bytes).digestHex();
}

/** Hash an async stream of byte slices without ever holding all of them. */
export async function sha256Stream(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const hash = new Sha256();
  for await (const slice of stream) hash.update(slice);
  return hash.digestHex();
}
