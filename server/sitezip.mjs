// A client's website as a zip: download the folder, or upload a new one to replace it. Uploads are checked
// file by file (safe paths, known file types, size limits) before anything touches the live site.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname, posix } from "node:path";
import { zipSync, unzipSync } from "fflate";

export const MAX_ZIP = 80e6;
const MAX_FILES = 3000;
const MAX_TOTAL = 250e6;
const MAX_FILE = 60e6;
const ALLOWED = new Set(["html", "htm", "css", "js", "mjs", "json", "txt", "xml", "webmanifest", "map", "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "woff", "woff2", "ttf", "otf", "eot", "mp4", "webm", "mp3", "ogg", "wav", "pdf", "vtt"]);

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

/**
 * Check an uploaded zip and return its files as { "path": bytes } with the site at the root.
 * A single top-level folder (how Finder and most tools zip a project) is unwrapped. Throws a readable message.
 */
export function readSiteZip(buf) {
  if (!buf?.length) throw new Error("The file is empty");
  if (buf.length > MAX_ZIP) throw new Error(`That zip is too big (max ${MAX_ZIP / 1e6} MB)`);
  let total = 0, count = 0;
  const own = (m) => Object.assign(new Error(m), { own: true });
  let raw;
  try {
    raw = unzipSync(new Uint8Array(buf), {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (++count > MAX_FILES) throw own(`The zip has more than ${MAX_FILES} files`);
        if (f.originalSize > MAX_FILE) throw own(`${f.name} is too big`);
        total += f.originalSize;
        if (total > MAX_TOTAL) throw own("The zip is too big once unpacked");
        return true;
      },
    });
  } catch (e) {
    throw e.own ? e : new Error("That is not a readable zip file");
  }
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
