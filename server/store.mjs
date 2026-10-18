// Tiny JSON-file store for the autonomous content studio (data/studio.json).
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, "..", "data");
export const MEDIA_DIR = join(DATA_DIR, "media");
mkdirSync(MEDIA_DIR, { recursive: true });
const FILE = join(DATA_DIR, "studio.json");

const empty = () => ({ clients: [], briefs: [], posts: [], videos: [], messages: [] });
export const db = existsSync(FILE) ? { ...empty(), ...JSON.parse(readFileSync(FILE, "utf8")) } : empty();

let saving = Promise.resolve();
/** Serialised, atomic save (write a temp file, then rename over the old one). */
export function save() {
  saving = saving.then(async () => {
    const tmp = FILE + ".tmp";
    await writeFile(tmp, JSON.stringify(db, null, 1));
    await rename(tmp, FILE);
  }).catch((e) => console.error("Saving studio data failed:", e.message));
  return saving;
}

export const id = () => Date.now().toString(36) + randomBytes(3).toString("hex");
export const token = () => randomBytes(12).toString("base64url");
export const now = () => new Date().toISOString();
