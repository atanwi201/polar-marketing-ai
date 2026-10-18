import { test } from "node:test";
import assert from "node:assert/strict";
import { rankModels, extractJson, isFree, complete } from "./openrouter.mjs";

const M = (id, prompt = "0", ctx = 32000) => ({ id, pricing: { prompt, completion: prompt }, context_length: ctx });
const LIST = [
  M("openai/gpt-4o", "0.000005"),
  M("meta-llama/llama-3.3-70b-instruct:free"),
  M("deepseek/deepseek-chat-v3-0324:free", "0", 160000),
  M("some/tiny-model:free", "0", 8000),
  M("google/gemini-2.0-flash-exp:free", "0", 1000000),
];

test("only free models are used", () => {
  assert.equal(isFree(LIST[0]), false);
  assert.ok(!rankModels(LIST).includes("openai/gpt-4o"));
});

test("ranking follows tier preferences", () => {
  assert.equal(rankModels(LIST, "default")[0], "deepseek/deepseek-chat-v3-0324:free");
  assert.equal(rankModels(LIST, "quick")[0], "google/gemini-2.0-flash-exp:free");
  assert.equal(rankModels(LIST, "default").at(-1), "some/tiny-model:free");
});

test("extractJson handles fences, prose and braces in strings", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": "x}y", "b": [1,2]}\n```'), { a: "x}y", b: [1, 2] });
  assert.deepEqual(extractJson('Here: [{"q": 1}] done'), [{ q: 1 }]);
  assert.throws(() => extractJson("no json here"));
  assert.deepEqual(extractJson('<think>maybe {a}</think>Note [1] then {"ok": true}'), { ok: true });
});

test("music, safety and code-only models are never picked for text", () => {
  const list = [
    { ...M("google/lyria-3-pro-preview", "0", 1048576), architecture: { input_modalities: ["text"], output_modalities: ["text", "audio"] } },
    M("nvidia/nemotron-3.5-content-safety:free", "0", 128000),
    M("cohere/north-mini-code:free", "0", 256000),
    M("openrouter/free", "0", 200000),
    M("nvidia/nemotron-3-ultra-550b-a55b:free", "0", 1000000),
    M("liquid/lfm-2.5-2.6b:free", "0", 65536),
  ];
  assert.deepEqual(rankModels(list, "default"), ["nvidia/nemotron-3-ultra-550b-a55b:free", "liquid/lfm-2.5-2.6b:free"]);
});

function mockFetch(handlers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: LIST }));
    return handlers.shift()(JSON.parse(init.body));
  };
  f.calls = calls;
  return f;
}

test("falls back to the next free model on a 429 and returns JSON", async () => {
  const f = mockFetch([
    () => new Response("rate limited", { status: 429 }),
    (b) => new Response(JSON.stringify({ model: b.models[0], choices: [{ message: { content: 'Result: {"reply":"Danke!"}' } }] })),
  ]);
  const out = await complete({ key: "k", prompt: "hi", json: true, tier: "complex", fetchImpl: f });
  assert.deepEqual(out.json, { reply: "Danke!" });
  const chats = f.calls.filter((c) => c.url.endsWith("/chat/completions"));
  assert.equal(chats.length, 2);
  assert.ok(chats.every((c) => c.body.models.every((m) => m.endsWith(":free"))));
  assert.notEqual(chats[0].body.models[0], chats[1].body.models[0]);
});

test("streams deltas", async () => {
  const sse = ['data: {"model":"x:free","choices":[{"delta":{"content":"Hola "}}]}', ": OPENROUTER PROCESSING", 'data: {"choices":[{"delta":{"content":"Marta"}}]}', "data: [DONE]", ""].join("\n");
  const f = mockFetch([() => new Response(sse)]);
  const parts = [];
  const out = await complete({ key: "k", prompt: "hi", onDelta: (d) => parts.push(d), fetchImpl: f });
  assert.equal(out.text, "Hola Marta");
  assert.deepEqual(parts, ["Hola ", "Marta"]);
});

test("a bad key stops immediately", async () => {
  const f = mockFetch([() => new Response("no", { status: 401 })]);
  await assert.rejects(complete({ key: "bad", prompt: "hi", fetchImpl: f }), /refused the key/);
});

test("falls through Groq (rate limited) and Mistral (bad key) to OpenRouter", async () => {
  const saved = { g: process.env.GROQ_API_KEY, m: process.env.MISTRAL_API_KEY };
  process.env.GROQ_API_KEY = "g"; process.env.MISTRAL_API_KEY = "m";
  try {
    const seen = [];
    const f = async (url, init) => {
      seen.push(url);
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: LIST }));
      if (url.includes("groq")) return new Response("slow down", { status: 429 });
      if (url.includes("mistral")) return new Response("no", { status: 401 });
      return new Response(JSON.stringify({ model: "x:free", choices: [{ message: { content: "ok" } }] }));
    };
    const out = await complete({ key: "k", prompt: "hi", fetchImpl: f });
    assert.equal(out.text, "ok");
    assert.ok(seen[0].includes("groq") && seen.some((u) => u.includes("mistral")) && seen.at(-1).includes("openrouter"));
  } finally {
    for (const [k, v] of [["GROQ_API_KEY", saved.g], ["MISTRAL_API_KEY", saved.m]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});
