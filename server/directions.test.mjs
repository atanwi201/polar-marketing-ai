import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTIONS, pickDirection, directionPrompt } from "./directions.mjs";

test("art directions suit the style, stay on rebuilds and change on a new design", () => {
  for (let i = 0; i < 30; i++) {
    const d = pickDirection({ style: "elegant", images: 5, newDesign: true });
    assert.ok(d.fits.includes("elegant"));
    assert.equal(pickDirection({ style: "elegant", images: 5, current: d.id }).id, d.id, "a rebuild keeps it");
    assert.notEqual(pickDirection({ style: "elegant", images: 5, current: d.id, newDesign: true }).id, d.id, "a new design changes it");
    assert.notEqual(pickDirection({ style: "natural", images: 1, newDesign: true }).id, "photographic", "photo-led needs photos");
  }
  for (const d of DIRECTIONS) assert.match(directionPrompt(d), /SiteInspire/);
});
