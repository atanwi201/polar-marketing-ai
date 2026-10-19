import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = join(mkdtempSync(join(tmpdir(), "durab-")), "data");
process.env.DATA_DIR = dir;
const { db, save, saveStatus } = await import("./store.mjs");
const FILE = join(dir, "studio.json");

test("50 parallel saves leave valid JSON, mode 0600, dir 0700 and a .bak", async () => {
  await Promise.all(Array.from({ length: 50 }, (_, i) => { db.clients.push({ id: "c" + i }); return save(); }));
  assert.equal(JSON.parse(readFileSync(FILE, "utf8")).clients.length, 50);
  assert.equal(statSync(FILE).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  db.clients.push({ id: "last" });
  await save();
  assert.ok(existsSync(FILE + ".bak"));
  assert.equal(statSync(FILE + ".bak").mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(FILE + ".bak", "utf8")).clients.length, 50);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  assert.ok(saveStatus.ok >= 1);
});

test("corrupt studio.json at boot falls back to .bak without crashing", () => {
  const code = `const { db } = await import("./store.mjs"); console.log("N=" + db.clients.length);`;
  writeFileSync(FILE, "{ truncated");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: import.meta.dirname, env: { PATH: process.env.PATH, DATA_DIR: dir }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /N=50/);
  assert.match(r.stderr, /corrupt/);
  assert.ok(readdirSync(dir).some((f) => f.startsWith("studio.json.corrupt-")));
});

test("loose permissions on an existing studio.json are tightened at boot", () => {
  writeFileSync(FILE, JSON.stringify({ clients: [] })); chmodSync(FILE, 0o644);
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `await import("./store.mjs")`], { cwd: import.meta.dirname, env: { PATH: process.env.PATH, DATA_DIR: dir } });
  assert.equal(r.status, 0);
  assert.equal(statSync(FILE).mode & 0o777, 0o600);
});

test("save() rejects when the write fails", { skip: process.getuid?.() === 0 }, async () => {
  chmodSync(dir, 0o500);
  try { await assert.rejects(save()); assert.ok(saveStatus.failed >= 1 && saveStatus.lastError); }
  finally { chmodSync(dir, 0o700); }
  await save();
});
