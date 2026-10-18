import { test } from "node:test";
import assert from "node:assert/strict";
import { qrSvg, qrPng } from "./qr.mjs";

test("QR codes come out as SVG and PNG", async () => {
  assert.match(await qrSvg("https://example.com/"), /^<svg/);
  const png = await qrPng("https://example.com/", 256);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
});
