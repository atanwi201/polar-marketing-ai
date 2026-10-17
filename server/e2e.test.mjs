// End-to-end: sign-up -> website + first post, then a portal brief, against a fake OpenRouter and Pollinations.
import http from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 1x1 jpeg
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
let chats = 0;
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
    if (req.url.startsWith("/prompt/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(JPG); }
    if (req.url === "/v1/models") { res.writeHead(200); return res.end(JSON.stringify({ data: [
      { id: "deepseek/deepseek-chat-v3-0324:free", pricing: { prompt: "0", completion: "0" }, context_length: 160000, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      { id: "google/gemini-2.0-flash-exp:free", pricing: { prompt: "0", completion: "0" }, context_length: 1000000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
      { id: "openai/gpt-4o", pricing: { prompt: "0.00001", completion: "0.00003" } } ] })); }
    if (req.url === "/v1/chat/completions") {
      chats++;
      const b = JSON.parse(body);
      const text = JSON.stringify(b.messages);
      if (b.models.some((m) => !m.endsWith(":free"))) { res.writeHead(500); return res.end("paid model used!"); }
      let content;
      if (Array.isArray(b.messages.at(-1).content)) content = "A sunny terrace with grilled fish on a white plate, sea in the background.";
      else if (text.includes("website copy")) content = "```json\n" + JSON.stringify({ metaTitle: "Tasca Prueba · Seafood restaurant Los Cristianos", metaDescription: "Fresh fish on the promenade. Book by WhatsApp.", h1: "Fresh fish by the sea", tagline: "Seafood in Los Cristianos", intro: "We grill the catch of the day.", services: [{ name: "Grilled fish", description: "Catch of the day." }, { name: "Paella", description: "For two." }], about: "Family run.", why: ["Fresh", "Sea view", "Local"], faq: [{ q: "Do you take bookings?", a: "Yes, on WhatsApp." }], cta: "Book on WhatsApp", keywords: ["seafood los cristianos"], imagePrompts: { hero: "terrace", services: ["fish", "paella"] } }) + "\n```";
      else content = JSON.stringify({ concept: "Catch of the day " + chats, imagePrompt: "grilled fish on a terrace", captions: { es: "Pescado fresco hoy", en: "Fresh fish today" }, hashtags: ["tenerife"], cta: "Reserva" });
      res.writeHead(200); return res.end(JSON.stringify({ model: b.models[0], choices: [{ message: { content } }] }));
    }
    res.writeHead(404); res.end();
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("sign-up builds a site and a post using only free models", async (t) => {
  await new Promise((ok) => mock.listen(9901, ok));
  const dir = mkdtempSync(join(tmpdir(), "isla-"));
  const srv = spawn(process.execPath, [join(import.meta.dirname, "index.mjs")], {
    env: { ...process.env, OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: "http://localhost:9901/v1", POLLINATIONS_BASE_URL: "http://localhost:9901", PORT: "8799", DATA_DIR: dir, SITES_DIR: join(dir, "sites") },
    stdio: "ignore",
  });
  t.after(() => { srv.kill(); mock.close(); });
  await sleep(800);
  const B = "http://localhost:8799";
  const r = await fetch(B + "/api/signup", { method: "POST", body: JSON.stringify({ name: "Tasca Prueba", kind: "Restaurant", town: "Los Cristianos", phone: "+34 600 000 000", email: "a@b.es", languages: ["es", "en"], offer: "Fresh fish on the promenade", acceptTerms: true }) });
  assert.equal(r.status, 201);
  const { token } = await r.json();
  let v;
  for (let i = 0; i < 40; i++) {
    v = await (await fetch(`${B}/api/portal/${token}`)).json();
    if (v.client.site?.status === "ready" && v.posts[0]?.status === "ready") break;
    await sleep(250);
  }
  assert.equal(v.client.site.status, "ready");
  assert.equal(v.posts[0].status, "ready");
  assert.ok(existsSync(join(dir, "sites", "tasca-prueba", "en", "index.html")));
  assert.equal((await fetch(`${B}/media/${v.posts[0].imageFile}`)).status, 200);
  const again = await fetch(`${B}/api/portal/${token}/posts/${v.posts[0].id}/again`, { method: "POST" });
  assert.equal(again.status, 201);
});
