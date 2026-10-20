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

// chmod resets the ACL mask, and a masked-off entry grants nothing. The operator sets a read-only
// ACL for the backup user, so a restart must not silently kill it.
const aclTools = () => process.platform === "linux" && !spawnSync("getfacl", ["-c", "-p", dir], { encoding: "utf8" }).error && !spawnSync("setfacl", ["--help"], { encoding: "utf8" }).error;
test("a read-only ACL for the backup user survives a restart", { skip: !aclTools() }, () => {
  const aclDir = join(mkdtempSync(join(tmpdir(), "acl-")), "data");
  mkdirSync(aclDir, { recursive: true });
  const group = spawnSync("id", ["-gn"], { encoding: "utf8" }).stdout.trim();
  assert.ok(group, "the current user needs a group to name in the ACL");
  assert.equal(spawnSync("setfacl", ["-m", `g:${group}:r-x`, aclDir]).status, 0);

  const boot = spawnSync(process.execPath, ["--input-type=module", "-e", `await import("./store.mjs")`], { cwd: import.meta.dirname, env: { PATH: process.env.PATH, DATA_DIR: aclDir } });
  assert.equal(boot.status, 0, boot.stderr);

  const acl = spawnSync("getfacl", ["-c", "-p", aclDir], { encoding: "utf8" }).stdout;
  assert.match(acl, new RegExp(`^group:${group}:r-x$`, "m"), "the named entry is still there");
  assert.doesNotMatch(acl, /#effective:---/, "the named entry is still effective (the mask was not reset)");
  assert.match(acl, /^group::---$/m, "the owning group still has no access");
  assert.match(acl, /^other::---$/m, "others still have no access");
});
