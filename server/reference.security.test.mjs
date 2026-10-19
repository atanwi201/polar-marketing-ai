import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, safeGet, guardedFetch } from "./reference.mjs";
import { sniffMedia, assertSafeImage, isRasterMagic } from "./images.mjs";
import { hardenInputs } from "./video.mjs";

test("isPrivateAddress covers IPv4, mapped, NAT64, 6to4 and special IPv6 ranges", () => {
  const priv = ["0.0.0.0", "0.1.2.3", "10.0.0.1", "127.0.0.1", "100.64.0.1", "100.127.255.1", "169.254.169.254", "172.16.0.1", "192.0.0.5", "192.168.1.1", "198.18.0.1", "198.19.255.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:169.254.169.254", "[::ffff:10.0.0.1]", "::127.0.0.1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b::169.254.169.254",
    "2002:7f00:1::", "2002:a9fe:a9fe::1", "fec0::1", "fc00::1", "fd12::1", "fe80::1", "feb0::1", "ff02::1", "2001:db8::1", "not-an-ip", ""];
  for (const ip of priv) assert.ok(isPrivateAddress(ip), ip);
  const pub = ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.0.1", "198.20.0.1", "::ffff:5db8:d822", "64:ff9b::808:808", "2002:808:808::1", "2606:4700:4700::1111", "2a00:1450:4001::200e"];
  for (const ip of pub) assert.ok(!isPrivateAddress(ip), ip);
});

test("hostnames that are IPs in disguise or local names are refused", async () => {
  const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  const fetchImpl = async () => new Response("<html>ok</html>", { headers: { "content-type": "text/html" } });
  for (const u of ["http://[::ffff:7f00:1]/", "http://[::ffff:127.0.0.1]/", "http://[64:ff9b::7f00:1]/", "http://127.1/", "http://0x7f.1/", "http://2130706433/", "http://localhost./", "http://a.localhost/", "http://x.internal/", "http://[fec0::1]/", "http://user:pw@example.com/", "http://example.com:8080/", "ftp://example.com/"]) {
    await assert.rejects(safeGet(u, { lookupImpl, fetchImpl }), undefined, u);
  }
});

test("DNS rebinding: a name that resolves to a private address on any answer is refused, and the connection is pinned to the checked address", async () => {
  let calls = 0;
  const rebinding = async () => (++calls === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
  const seen = [];
  const fetchImpl = async (href, o) => { seen.push(o.pinned); return new Response("<html></html>", { headers: { "content-type": "text/html" } }); };
  await safeGet("https://rebind.example/", { lookupImpl: rebinding, fetchImpl });
  assert.equal(calls, 1, "resolved once per hop");
  assert.deepEqual(seen, [{ address: "93.184.216.34", family: 4 }], "fetch is told which address to use");
  await assert.rejects(safeGet("https://mixed.example/", { lookupImpl: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }], fetchImpl }), /private/);
});

test("every redirect hop is re-validated and the number of hops is limited", async () => {
  const pub = async () => [{ address: "93.184.216.34", family: 4 }];
  const to = (l) => async () => new Response(null, { status: 302, headers: { location: l } });
  await assert.rejects(safeGet("https://a.example/", { lookupImpl: pub, fetchImpl: to("http://[::ffff:a9fe:a9fe]/latest") }), /private/);
  await assert.rejects(guardedFetch("https://a.example/", { lookupImpl: pub, fetchImpl: to("https://a.example/loop") }), /Too many redirects/);
  const lookups = [];
  const look = async (h) => { lookups.push(h); return h === "evil.example" ? [{ address: "192.168.0.9" }] : [{ address: "93.184.216.34" }]; };
  await assert.rejects(safeGet("https://a.example/", { lookupImpl: look, fetchImpl: to("https://evil.example/") }), /private/);
  assert.deepEqual(lookups, ["a.example", "evil.example"]);
});

test("response size is capped", async () => {
  const pub = async () => [{ address: "93.184.216.34", family: 4 }];
  const big = async () => new Response("a".repeat(5000), { headers: { "content-type": "text/html" } });
  const r = await safeGet("https://a.example/", { lookupImpl: pub, fetchImpl: big, max: 1000 });
  assert.equal(r.text.length, 1000);
});

test("magic bytes and pixel caps for uploaded media", () => {
  const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  assert.equal(sniffMedia(png(1, 1)), "png");
  assert.equal(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(sniffMedia(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])), "webp");
  assert.equal(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")])), "mp4");
  assert.equal(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypqt  ")])), "mov");
  assert.equal(sniffMedia(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0])), "webm");
  assert.equal(sniffMedia(Buffer.from("#EXTM3U\nfile:///etc/passwd")), null);
  assert.equal(isRasterMagic(Buffer.from("<svg onload=1>")), false);
  assert.ok(assertSafeImage(png(1000, 1000)));
  assert.throws(() => assertSafeImage(png(60000, 60000)), /too large/);
  assert.throws(() => assertSafeImage(Buffer.from("GIF nope")), /not a valid/);
});

test("ffmpeg inputs only read local files", () => {
  assert.deepEqual(hardenInputs(["-y", "-ss", "1", "-i", "a.mp4", "-f", "lavfi", "-i", "anullsrc", "out.mp4"]),
    ["-y", "-ss", "1", "-protocol_whitelist", "file", "-i", "a.mp4", "-f", "lavfi", "-protocol_whitelist", "file", "-i", "anullsrc", "out.mp4"]);
});
