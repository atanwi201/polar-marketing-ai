// Without an OpenRouter key the studio must never write template text: the post waits and is retried.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "studio-"));
delete process.env.OPENROUTER_API_KEY;
const { db } = await import("./store.mjs");
const { startPost, retryDue } = await import("./studio.mjs");

test("no key: post waits with nextTryAt, no captions, and is retried when due", async () => {
  const client = { id: "c1", name: "Tasca", town: "Adeje", languages: ["es", "en"] };
  const brief = { id: "b1", clientId: "c1", text: "Fresh fish today", createdAt: new Date().toISOString() };
  db.clients.push(client); db.briefs.push(brief);
  const post = startPost(client, brief);
  for (let i = 0; i < 50 && post.status === "generating"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(post.status, "waiting");
  assert.equal(post.error, "Waiting for the AI to be available");
  assert.ok(post.nextTryAt && Date.parse(post.nextTryAt) > Date.now());
  assert.equal(post.captions, undefined);
  assert.equal(post.attempts, 1);

  assert.equal(retryDue(Date.now()).length, 0, "not due yet");
  const due = retryDue(Date.now() + 2 * 60e3);
  assert.equal(due.length, 1);
  assert.equal(post.status, "generating");
  for (let i = 0; i < 50 && post.status === "generating"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(post.status, "waiting");
  assert.equal(post.attempts, 2);
});

test("autopilot posts daily even without briefs (AI picks the topic)", async () => {
  const { db } = await import("./store.mjs");
  const { tick } = await import("./studio.mjs");
  const c = { id: "daily1", name: "Bar Daily", offer: "Tapas", autopilot: true, postsPerWeek: 3, languages: ["es"] };
  db.clients.push(c);
  const t0 = Date.now();
  tick(t0);
  const mine = () => db.posts.filter((p) => p.clientId === c.id);
  assert.equal(mine().length, 1);
  assert.equal(mine()[0].briefId, null);
  // Even with postsPerWeek 3 it posts again a day later, once the first post is settled.
  Object.assign(mine()[0], { status: "ready", nextTryAt: undefined, createdAt: new Date(t0 - 86400e3 - 1000).toISOString() });
  tick(t0);
  assert.equal(mine().length, 2);
});
