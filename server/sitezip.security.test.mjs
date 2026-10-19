import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, deflateSync } from "fflate";
import { readSiteZip } from "./sitezip.mjs";

const enc = (s) => new TextEncoder().encode(s);
const zip = (files) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? enc(v) : v]))));

test("unsafe names reject the whole archive", () => {
  for (const name of ["../x.html", "a/../../x.html", "/etc/x.html", "C:/x.html", "a\\..\\..\\x.html"]) {
    assert.throws(() => readSiteZip(zip({ "index.html": "x", [name]: "x" })), /Unsafe/, name);
  }
});

test("symlink entries are rejected", () => {
  const z = Buffer.from(zip({ "index.html": "x", "link.html": "index.html" }));
  // Mark link.html as a unix symlink in the central directory (host 3, mode 0120777).
  const dv = new DataView(z.buffer, z.byteOffset, z.length);
  for (let p = 0; p + 46 < z.length; p++) {
    if (dv.getUint32(p, true) === 0x02014b50 && z.subarray(p + 46, p + 46 + 9).toString() === "link.html") {
      dv.setUint16(p + 4, (3 << 8) | 20, true);
      dv.setUint32(p + 38, (0o120777 << 16) >>> 0, true);
    }
  }
  assert.throws(() => readSiteZip(z), /link/);
});

test("limits count real decompressed bytes, not the sizes in the headers", () => {
  // 70 MB of zeros compresses to ~70 KB; lie about its size in the local and central headers (claim 10 bytes).
  const body = new Uint8Array(70e6);
  const z = Buffer.from(zip({ "index.html": "x", "big.js": body }));
  const dv = new DataView(z.buffer, z.byteOffset, z.length);
  for (let p = 0; p + 46 < z.length; p++) {
    const sig = dv.getUint32(p, true);
    if (sig === 0x02014b50) dv.setUint32(p + 24, 10, true);
    if (sig === 0x04034b50 && z.subarray(p + 30, p + 36).toString() === "big.js") dv.setUint32(p + 22, 10, true);
  }
  assert.throws(() => readSiteZip(z), /too big/);
});

test("too many entries", () => {
  const files = {};
  for (let i = 0; i < 3001; i++) files[`f${i}.txt`] = "x";
  files["index.html"] = "x";
  assert.throws(() => readSiteZip(zip(files)), /more than 3000/);
});

test("a normal zip still works", () => {
  const out = readSiteZip(zip({ "site/index.html": "<h1>x</h1>", "site/css/a.css": "a{}" }));
  assert.deepEqual(Object.keys(out).sort(), ["css/a.css", "index.html"]);
});

test("swapDir replaces atomically and keeps the old site when the swap fails", async () => {
  const { swapDir } = await import("./sitebuilder.mjs");
  const root = await mkdtemp(join(tmpdir(), "swap-"));
  try {
    const dir = join(root, "site"), work = join(root, ".site.building");
    await mkdir(dir); await writeFile(join(dir, "old.txt"), "old");
    await mkdir(work); await writeFile(join(work, "new.txt"), "new");
    await swapDir(work, dir);
    assert.deepEqual(await readdir(dir), ["new.txt"]);
    assert.deepEqual((await readdir(root)).sort(), ["site"], "no temp folders left");
    // work is missing: the swap fails and the live site is restored
    await assert.rejects(swapDir(join(root, ".missing"), dir));
    assert.deepEqual(await readdir(dir), ["new.txt"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
