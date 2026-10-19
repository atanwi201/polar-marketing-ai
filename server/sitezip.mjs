// A client's website as a zip: download the folder, or upload a new one to replace it. Uploads are checked
// file by file (safe paths, known file types, size limits) before anything touches the live site.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname, posix } from "node:path";
import { zipSync, Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

export const MAX_ZIP = 80e6;
const MAX_FILES = 3000;
const MAX_TOTAL = 250e6;
const MAX_FILE = 60e6;
const ALLOWED = new Set(["html", "htm", "css", "js", "mjs", "json", "txt", "xml", "webmanifest", "map", "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "woff", "woff2", "ttf", "otf", "eot", "mp4", "webm", "mp3", "ogg", "wav", "pdf", "vtt"]);

function concat(chunks, size) {
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Reject names that could escape the site folder. */
function checkName(name) {
  const p = name.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-z]:/i.test(p) || p.split("/").includes("..") || /[\u0000-\u001f]/.test(p)) throw new Error(`Unsafe path in the zip: ${name}`);
}

/** Every file under dir as { "relative/path": bytes }, skipping hidden files. */
async function walk(dir, base = "") {
  const out = {};
  for (const e of await readdir(join(dir, base), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, await walk(dir, rel));
    else if (e.isFile()) out[rel] = new Uint8Array(await readFile(join(dir, rel)));
  }
  return out;
}

/** The site folder as one zip (Buffer). */
export async function zipSite(dir) {
  const files = await walk(dir);
  if (!Object.keys(files).length) throw new Error("There is no site to download yet");
  return Buffer.from(zipSync(files, { level: 6 }));
}

/** Zip central directory entries (name, unix mode) read straight from the bytes: sizes there can lie, symlink modes can't hide. */
function centralDirectory(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd === -1) return null;
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < total && p + 46 <= buf.length && dv.getUint32(p, true) === 0x02014b50; k++) {
    const flags = dv.getUint16(p + 8, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const host = dv.getUint16(p + 4, true) >> 8;
    const mode = host === 3 ? (dv.getUint32(p + 38, true) >>> 16) & 0xf000 : 0;
    out.push({ name: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)), symlink: mode === 0xa000, encrypted: !!(flags & 1) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries: out, declared: total };
}

/**
 * Check an uploaded zip and return its files as { "path": bytes } with the site at the root.
 * A single top-level folder (how Finder and most tools zip a project) is unwrapped. Throws a readable message.
 * Limits apply to the bytes actually produced while inflating (the sizes written in the zip are ignored),
 * and unsafe names (absolute, "..", NUL, symlink entries) reject the whole archive.
 */
export function readSiteZip(buf) {
  if (!buf?.length) throw new Error("The file is empty");
  if (buf.length > MAX_ZIP) throw new Error(`That zip is too big (max ${MAX_ZIP / 1e6} MB)`);
  const own = (m) => Object.assign(new Error(m), { own: true });
  const u8 = new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  const cd = centralDirectory(u8);
  if (!cd) throw new Error("That is not a readable zip file");
  {
    if (cd.declared > MAX_FILES || cd.entries.length > MAX_FILES) throw own(`The zip has more than ${MAX_FILES} files`);
    for (const e of cd.entries) {
      if (e.symlink) throw new Error(`Unsafe entry in the zip (link): ${e.name}`);
      if (e.encrypted) throw own("That zip is password protected");
      checkName(e.name);
    }
  }
  let total = 0, count = 0, err = null;
  const raw = {};
  const uz = new Unzip((f) => {
    if (err || f.name.endsWith("/")) return;
    try {
      if (++count > MAX_FILES) throw own(`The zip has more than ${MAX_FILES} files`);
      checkName(f.name);
      const chunks = [];
      let size = 0;
      f.ondata = (e, chunk, final) => {
        if (err) return;
        if (e) { err = e; return; }
        size += chunk.length; total += chunk.length;
        if (size > MAX_FILE) { err = own(`${f.name} is too big`); f.terminate(); return; }
        if (total > MAX_TOTAL) { err = own("The zip is too big once unpacked"); f.terminate(); return; }
        chunks.push(chunk);
        if (final) raw[f.name] = chunks.length === 1 ? chunks[0] : concat(chunks, size);
      };
      f.start();
    } catch (e) { err = e; }
  });
  uz.register(UnzipInflate);
  uz.register(UnzipPassThrough);
  try { uz.push(u8, true); } catch (e) { err ??= e; }
  if (err) throw err.own || /^Unsafe path/.test(err.message) ? err : new Error("That is not a readable zip file");
  const clean = {};
  for (const [name, data] of Object.entries(raw)) {
    const path = posix.normalize(name.replace(/\\/g, "/")).replace(/^\.\//, "");
    const parts = path.split("/");
    if (path.startsWith("/") || parts.includes("..")) throw new Error(`Unsafe path in the zip: ${name}`);
    if (parts.some((p) => p.startsWith(".") || p === "__MACOSX")) continue; // .DS_Store, resource forks, dotfiles
    const ext = (parts.at(-1).split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.has(ext) || !parts.at(-1).includes(".")) throw new Error(`File type not allowed: ${name}`);
    clean[path] = data;
  }
  let paths = Object.keys(clean);
  if (!paths.length) throw new Error("The zip has no files");
  const tops = new Set(paths.map((p) => p.split("/")[0]));
  if (!clean["index.html"] && tops.size === 1 && paths.every((p) => p.includes("/"))) {
    const top = [...tops][0] + "/";
    for (const p of paths) { clean[p.slice(top.length)] = clean[p]; delete clean[p]; }
    paths = Object.keys(clean);
  }
  if (!clean["index.html"]) throw new Error("The zip needs an index.html at its top level");
  return clean;
}

/** Write checked files into dir. */
export async function writeSiteFiles(files, dir) {
  for (const [path, data] of Object.entries(files)) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
}
