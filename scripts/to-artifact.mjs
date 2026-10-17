// Turns Vite's single-file build into an Artifact page body (the publisher adds doctype/html/head/body).
import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync("dist/index.html", "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const keep = head
  .replace(/<meta charset[^>]*>/, "")
  .replace(/<meta name="viewport"[^>]*>/, "");
// Scripts must run after #root exists, so move them below the body markup.
const scripts = [];
const rest = keep.replace(/<script\b[\s\S]*?<\/script>/g, (s) => (scripts.push(s), ""));
writeFileSync("dist/artifact.html", rest.trim() + "\n" + body.trim() + "\n" + scripts.join("\n") + "\n");
console.log("dist/artifact.html", (readFileSync("dist/artifact.html").length / 1024).toFixed(0) + " KiB");
