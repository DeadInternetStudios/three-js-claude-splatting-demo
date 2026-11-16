import { gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vitest/config";

const SPARK_WASM_CALL = /\(typeof atob === "function" \? toUint8 : base64ToUint8\)\("([A-Za-z0-9+/=]{100000,})"\)/;

const INFLATE = `
const LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const inflateGzip = (bytes) => {
  let p = 10;
  const flg = bytes[3];
  if (flg & 4) p += 2 + (bytes[p] | (bytes[p + 1] << 8));
  if (flg & 8) while (bytes[p++]) {}
  if (flg & 16) while (bytes[p++]) {}
  if (flg & 2) p += 2;
  let bitbuf = 0, bitcnt = 0;
  const bit = () => { if (bitcnt === 0) { bitbuf = bytes[p++]; bitcnt = 8; } const v = bitbuf & 1; bitbuf >>= 1; bitcnt--; return v; };
  const bits = (n) => { let v = 0; for (let i = 0; i < n; i++) v |= bit() << i; return v; };
  const build = (lengths) => {
    const counts = new Array(16).fill(0);
    for (const l of lengths) counts[l]++;
    if (counts[0] === lengths.length) return null;
    const offs = new Array(16).fill(0);
    for (let i = 1; i < 15; i++) offs[i + 1] = offs[i] + counts[i];
    const symbols = [];
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offs[lengths[s]]++] = s;
    return { counts, symbols };
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bit();
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error("bad code in compressed data");
  };
  let out = new Uint8Array(1 << 20), outLen = 0;
  const grow = (n) => { if (outLen + n > out.length) { const next = new Uint8Array(Math.max(out.length * 2, outLen + n)); next.set(out); out = next; } };
  for (;;) {
    const last = bit(), type = bits(2);
    if (type === 0) {
      bitcnt = 0;
      const len = bytes[p] | (bytes[p + 1] << 8);
      p += 4;
      grow(len);
      out.set(bytes.subarray(p, p + len), outLen);
      outLen += len; p += len;
    } else {
      let lit, dist;
      if (type === 1) {
        const ll = []; for (let i = 0; i < 288; i++) ll.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
        lit = build(ll); dist = build(new Array(30).fill(5));
      } else {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        const cl = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) cl[order[i]] = bits(3);
        const ch = build(cl), lengths = [];
        while (lengths.length < hlit + hdist) {
          const s = decode(ch);
          if (s < 16) lengths.push(s);
          else if (s === 16) { const prev = lengths[lengths.length - 1]; for (let r = 3 + bits(2); r > 0; r--) lengths.push(prev); }
          else if (s === 17) { for (let r = 3 + bits(3); r > 0; r--) lengths.push(0); }
          else { for (let r = 11 + bits(7); r > 0; r--) lengths.push(0); }
        }
        lit = build(lengths.slice(0, hlit)); dist = build(lengths.slice(hlit));
      }
      for (;;) {
        const s = decode(lit);
        if (s < 256) { grow(1); out[outLen++] = s; }
        else if (s === 256) break;
        else {
          const li = s - 257, len = LB[li] + bits(LE[li]);
          const ds = decode(dist), back = DB[ds] + bits(DE[ds]);
          grow(len);
          for (let i = 0; i < len; i++) { out[outLen] = out[outLen - back]; outLen++; }
        }
      }
    }
    if (last) break;
  }
  // slice, not subarray: the caller hands .buffer on, so the bytes must fill their buffer exactly.
  return out.slice(0, outLen);
};
`;

const GUNZIP = INFLATE + `const gunzipBase64 = async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (typeof DecompressionStream === "function") {
    try {
      return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    } catch { /* fall through to the built-in unpacker */ }
  }
  return inflateGzip(bytes);
};
`;

/**
 * Spark ships its WebAssembly as one base64 string, 2.4 MB of the page. Gzipping the bytes at build time
 * and unpacking them in the browser leaves 0.8 MB. Browsers without DecompressionStream use the small
 * inflate above instead, so an older Safari still runs. The build fails when Spark's wrapper changes
 * shape, so a Spark upgrade cannot quietly bring the full size back.
 */
function sparkWasmGzip(): Plugin {
  return {
    name: "spark-wasm-gzip",
    apply: "build",
    transform(code, id) {
      if (!/@sparkjsdev\/spark\/dist\/spark\.module\.js$/.test(id)) return null;
      const match = SPARK_WASM_CALL.exec(code);
      if (!match) this.error("spark-wasm-gzip: cannot find Spark's embedded WebAssembly. Update SPARK_WASM_CALL in vite.config.ts.");
      const packed = gzipSync(Buffer.from(match[1]!, "base64"), { level: 9 }).toString("base64");
      return GUNZIP + code.replace(SPARK_WASM_CALL, () => `(await gunzipBase64("${packed}"))`);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [sparkWasmGzip()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
  },
  optimizeDeps: { exclude: ["@sparkjsdev/spark"] },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/.work/**", "**/out/**", "**/dist/**", "**/.venv/**", "**/test-results/**"] },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
