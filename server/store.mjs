// Tiny JSON-file store for the autonomous content studio (data/studio.json).
// Durability: every save writes a temp file in the same directory, fsyncs it, keeps the previous good copy as
// studio.json.bak and renames over the main file. A corrupt main file at boot falls back to the .bak. Saves are
// serialised (one write at a time, callers that arrive during a write share the next one) and failures reject.
import { readFileSync, existsSync, mkdirSync, chmodSync, statSync, renameSync, openSync, writeSync, fsyncSync, closeSync, copyFileSync } from "node:fs";
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

/** Tighten a path that is looser than `mode` (only when we own it; never fails the boot). */
function tighten(path, mode) {
  try {
    const st = statSync(path);
    if (st.uid === process.getuid?.() && (st.mode & 0o077)) {
      // chmod resets the ACL mask, and a masked-off entry grants nothing: that silently disabled the
      // read-only ACL the operator sets for the backup user, so every restart broke the backups.
      // Tighten the mode as usual, then put the mask back so that ACL keeps working.
      const bits = (st.mode & 0o070) >> 3;
      const mask = `${bits & 4 ? "r" : "-"}${bits & 2 ? "w" : "-"}${bits & 1 ? "x" : "-"}`;
      const named = hasNamedAcl(path);
      chmodSync(path, mode);
      if (named && mask !== "---") {
        try { execFileSync("setfacl", ["-m", `m::${mask}`, path], { stdio: "ignore" }); }
        catch { console.warn("[store] could not restore an ACL mask (is the acl package installed?)"); }
      }
    }
  } catch { /* missing or not ours */ }
}
tighten(DATA_DIR, 0o700);
tighten(MEDIA_DIR, 0o700);
tighten(FILE, 0o600);
tighten(BAK, 0o600);

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
  const fd = openSync(tmp, "w", 0o600);
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    if (existsSync(FILE)) { copyFileSync(FILE, BAK); try { chmodSync(BAK, 0o600); } catch { /* best effort */ } }
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
