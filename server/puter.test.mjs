import { test } from "node:test";
import assert from "node:assert/strict";
import { toBuffer } from "./puter.mjs";

test("Puter results become bytes: data URLs, links, blobs and raw bytes", async () => {
  assert.equal((await toBuffer({ src: "data:image/png;base64,aGVsbG8=" })).toString(), "hello");
  assert.equal((await toBuffer("data:audio/mpeg;base64,aGk=")).toString(), "hi");
  assert.equal((await toBuffer(new Blob(["blob"]))).toString(), "blob");
  assert.equal((await toBuffer(Buffer.from("raw"))).toString(), "raw");
  const f = async () => new Response("remote");
  assert.equal((await toBuffer({ src: "https://x.test/a.png" }, f)).toString(), "remote");
  await assert.rejects(toBuffer({ src: "blob:http://x/1" }), /can't open/);
  await assert.rejects(toBuffer(null), /nothing/);
});
