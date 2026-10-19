// Every inline <script> in server/*.html must parse: one stray backtick blanks a whole page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { writeFileSync, mkdtempSync } from "node:fs";

const dir = import.meta.dirname;
const tmp = mkdtempSync(join(tmpdir(), "html-syntax-"));
for (const f of readdirSync(dir).filter((n) => n.endsWith(".html"))) {
  test(`inline scripts parse: ${f}`, () => {
    const html = readFileSync(join(dir, f), "utf8");
    const re = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/g;
    let m, i = 0;
    while ((m = re.exec(html))) {
      const file = join(tmp, `${f}.${i++}.mjs`);
      writeFileSync(file, m[1]);
      try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
      catch (e) { assert.fail(`${f} script #${i}: ${String(e.stderr).split("\n").slice(0, 4).join(" ")}`); }
    }
  });
}
