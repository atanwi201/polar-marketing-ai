// Tiny JSON-file store for the autonomous content studio (data/studio.json).
// Durability: every save writes a temp file in the same directory, fsyncs it, keeps the previous good copy as
// studio.json.bak and renames over the main file. A corrupt main file at boot falls back to the .bak. Saves are
// serialised (one write at a time, callers that arrive during a write share the next one) and failures reject.
import { readFileSync, existsSync, mkdirSync, chmodSync, statSync, renameSync, openSync, writeSync, fsyncSync, closeSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

export const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, "..", "data");
export const MEDIA_DIR = join(DATA_DIR, "media");
mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o700 });
const FILE = join(DATA_DIR, "studio.json");
const BAK = FILE + ".bak";

/** Does this path carry an ACL with named users or groups? That is an exception the operator set on purpose. */
function hasNamedAcl(path) {
  try {
    const out = execFileSync("getfacl", ["-c", "-p", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /^(user|group):[^:]+:/m.test(out);
  } catch { return false; }
}

/** The mask of the ACL, as rwx letters ("r-x"). */
const maskLetters = (out, prefix = "") => out.match(new RegExp(`^${prefix}mask::([rwx-]{3})$`, "m"))?.[1] ?? "";

/** Set the access mask of a path (the tool is only there when the acl package is installed). */
function setMask(path, letters) {
  try { execFileSync("setfacl", ["-m", `m::${letters}`, path], { stdio: "ignore" }); return true; }
  catch { return false; }
}

/** The access mask of a folder can be dead while its default ACL still holds what the operator
 *  wanted: a chmod at some point reset it, and a masked-off entry grants nothing. The app owns the
 *  folder, so it can put the access mask back to the default one and the read-only ACL for the
 *  backup user keeps working. It only ever revives a dead mask, never widens anything. */
export function healMask(path) {
  try {
    const out = execFileSync("getfacl", ["-c", "-p", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (!hasNamedAcl(path)) return;                                  // no exception to protect
    if (maskLetters(out) !== "---") return;                          // the access mask is alive
    const def = maskLetters(out, "default:");
    if (!def || def === "---") return;                               // nothing to restore it to
    setMask(path, def);
  } catch { /* no acl tool here: the mode is still tight */ }
}

/** Does the folder's default ACL let a named group read? That is the operator's read-only ACL for the
 *  backup user. New files inherit it, but only as far as their own mode allows: a file created 0600 gets
 *  the named entry with its mask off, so the backup can read the folder and none of the files in it. */
function folderSharesRead(dir) {
  try {
    const out = execFileSync("getfacl", ["-c", "-p", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /^default:group:[^:]+:[rwx-]*r/m.test(out) && /^default:mask::[rwx-]*r/m.test(out);
  } catch { return false; }
}

/** Group read for the ACL, when the operator granted it on the folder; nothing at all otherwise. */
const SHARED_READ = folderSharesRead(DATA_DIR) ? 0o040 : 0;
const FILE_MODE = 0o600 | SHARED_READ;

/** Make one of our files readable through that ACL. chmod sets the mask from the group bits, so 0640
 *  makes the inherited named entry work again; it never touches a file we do not own. */
function healRead(path) {
  if (!SHARED_READ) return;
  try {
    const st = statSync(path);
    if (st.uid !== process.getuid?.() || !st.isFile() || (st.mode & 0o040)) return;
    chmodSync(path, 0o640);
  } catch { /* missing or not ours */ }
}

/** Files written before the ACL existed are still 0600, and the backup's rsync fails on the first file it
 *  cannot read. Run at boot, when the ACL is known; it only ever adds group read to our own files. */
function healReadTree(dir) {
  if (!SHARED_READ) return;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { healMask(path); healReadTree(path); }
      else if (entry.isFile()) healRead(path);
    }
  } catch { /* not ours, or it vanished */ }
}

/** Tighten a path that is looser than `mode` (only when we own it; never fails the boot). */
function tighten(path, mode) {
  try {
    const st = statSync(path);
    if (st.uid === process.getuid?.() && (st.mode & 0o077)) {
      // chmod resets the ACL mask, and a masked-off entry grants nothing: that silently disabled the
      // read-only ACL the operator sets for the backup user, so every restart broke the backups.
      // Tighten the mode as usual, then put the mask back so that ACL keeps working.
      const mask = (st.mode & 0o070) >> 3;
      const named = hasNamedAcl(path);
      chmodSync(path, mode);
      if (named && mask) setMask(path, `${mask & 4 ? "r" : "-"}${mask & 2 ? "w" : "-"}${mask & 1 ? "x" : "-"}`);
    }
    healMask(path);
  } catch { /* missing or not ours */ }
}
tighten(DATA_DIR, 0o700);
tighten(MEDIA_DIR, 0o700);
tighten(FILE, FILE_MODE);
tighten(BAK, FILE_MODE);
healReadTree(DATA_DIR);

const empty = () => ({ clients: [], briefs: [], posts: [], videos: [], messages: [] });

function readJson(path) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a JSON object");
  return v;
}

function loadDb() {
  if (!existsSync(FILE)) {
    if (!existsSync(BAK)) return empty();
    console.warn("studio.json is missing; restoring from studio.json.bak");
    return { ...empty(), ...readJson(BAK) };
  }
  try {
    return { ...empty(), ...readJson(FILE) };
  } catch (e) {
    console.warn(`studio.json is corrupt (${e.message}); falling back to studio.json.bak`);
    let restored;
    try { restored = { ...empty(), ...readJson(BAK) }; } catch (e2) {
      throw new Error(`studio.json is corrupt (${e.message}) and there is no usable studio.json.bak (${e2.message}). Fix or restore it by hand.`);
    }
    try { renameSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch { /* keep going with the backup */ }
    return restored;
  }
}
export const db = loadDb();

/** Health of the write path, for logs and diagnostics. */
export const saveStatus = { ok: 0, failed: 0, lastError: "", lastErrorAt: "", lastOkAt: "" };

function fsyncDir(dir) {
  try { const fd = openSync(dir, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* not supported here */ }
}

function writeOnce() {
  const tmp = `${FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const data = JSON.stringify(db, null, 1);
  const fd = openSync(tmp, "w", FILE_MODE);
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    if (existsSync(FILE)) { copyFileSync(FILE, BAK); try { chmodSync(BAK, FILE_MODE); } catch { /* best effort */ } }
    renameSync(tmp, FILE);
  } catch (e) {
    try { renameSync(tmp, tmp + ".failed"); } catch { /* ignore */ }
    throw e;
  }
  fsyncDir(dirname(FILE));
}

let running = false;
let waiters = [];
function pump() {
  if (running || !waiters.length) return;
  running = true;
  const batch = waiters; waiters = [];
  // Yield first so a burst of synchronous save() calls shares one write.
  setImmediate(() => {
    let err;
    try { writeOnce(); saveStatus.ok++; saveStatus.lastOkAt = new Date().toISOString(); } catch (e) {
      err = e; saveStatus.failed++; saveStatus.lastError = e.message; saveStatus.lastErrorAt = new Date().toISOString();
      console.error("Saving studio data failed:", e.message);
    }
    for (const w of batch) err ? w.reject(err) : w.resolve();
    running = false;
    pump();
  });
}

/**
 * Serialised, atomic, coalescing save. Resolves once a write that started after this call is on disk;
 * rejects when the write failed. `void save()` callers never cause an unhandled rejection.
 */
export function save() {
  const p = new Promise((resolve, reject) => { waiters.push({ resolve, reject }); });
  p.catch(() => {}); // fire-and-forget callers: failure is logged and recorded in saveStatus
  pump();
  return p;
}

export const id = () => Date.now().toString(36) + randomBytes(3).toString("hex");
export const token = () => randomBytes(12).toString("base64url");
export const now = () => new Date().toISOString();
