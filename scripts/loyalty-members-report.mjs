// Reports the state of loyalty cards before anyone merges anything (plan A.6, step 4).
//
// Dry run, always: this file opens the data file read-only, never calls the store, and has no flag
// that writes. It answers three questions for the owner: how many old cards have no usable number,
// which cards share a normalised phone inside the same programme, and which share an email. Both
// are what a double join looks like, and both are what the owner merges by hand with
// POST /api/studio/loyalty/programs/<id>/merge {keepId, mergeId, confirm:true}.
//
// Numbers and emails are masked: this output may be pasted into a chat. Card ids are not personal
// data and are what the merge call needs.
//
//   node scripts/loyalty-members-report.mjs [--data path/to/studio.json] [--json]
//
// With no --data it reads $DATA_DIR/studio.json, the same file the server uses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalisePhone, maskPhone } from "../server/phone.mjs";

const lower = (v) => String(v ?? "").trim().toLowerCase();
const groupBy = (list, key) => {
  const out = new Map();
  for (const item of list) {
    const k = key(item);
    if (!k) continue;
    const g = out.get(k) ?? [];
    g.push(item);
    out.set(k, g);
  }
  return out;
};
const maskEmail = (email) => {
  const [user, domain = ""] = lower(email).split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}${"*".repeat(Math.max(3, user.length - 1))}@${domain}`;
};
const sortCards = (cards) => [...cards].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id).localeCompare(String(b.id)));

/** The whole report, from a parsed studio.json. Pure: no disk, no store, no mutation of `data`. */
export function reportLoyalty(data) {
  const l = data?.loyalty ?? {};
  const members = new Map((l.members ?? []).map((m) => [m.id, m]));
  const programs = l.programs ?? [];
  const customers = l.customers ?? [];

  const card = (c) => {
    const member = c.memberId ? members.get(c.memberId) : undefined;
    return {
      id: c.id, name: String(c.name ?? ""), token: c.cardToken ?? "", createdAt: c.createdAt ?? "",
      programId: c.programId ?? "", memberId: c.memberId ?? "",
      phone: member?.phone || normalisePhone(c.phone ?? "")?.e164 || "",
      email: lower(c.email),
    };
  };
  const cards = customers.map(card);
  const programIds = new Set(programs.map((p) => p.id));

  const rows = programs.map((p) => {
    const mine = sortCards(cards.filter((c) => c.programId === p.id));
    const withPhone = mine.filter((c) => c.phone);
    const dupPhones = [...groupBy(withPhone, (c) => c.phone).values()].filter((g) => g.length > 1);
    const dupEmails = [...groupBy(mine.filter((c) => c.email), (c) => c.email).values()].filter((g) => g.length > 1);
    return {
      id: p.id,
      name: String(p.name ?? ""),
      clientId: p.clientId ?? "",
      status: p.status ?? "",
      cards: mine.length,
      withPhone: withPhone.length,
      withoutPhone: mine.length - withPhone.length,
      oldCards: mine.filter((c) => !c.memberId).length,
      duplicatePhones: dupPhones
        .map((g) => ({ key: maskPhone(g[0].phone), count: g.length, cards: g.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt })) }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
      duplicateEmails: dupEmails
        .map((g) => ({ key: maskEmail(g[0].email), count: g.length, cards: g.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt })) }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    };
  });

  const orphans = sortCards(cards.filter((c) => !programIds.has(c.programId))).map((c) => ({ id: c.id, name: c.name }));
  return {
    file: "",
    dryRun: true,
    programs: rows,
    totals: {
      programs: rows.length,
      cards: cards.length,
      withPhone: cards.filter((c) => c.phone).length,
      withoutPhone: cards.filter((c) => !c.phone).length,
      oldCards: cards.filter((c) => !c.memberId).length,
      duplicatePhoneGroups: rows.reduce((n, r) => n + r.duplicatePhones.length, 0),
      duplicateEmailGroups: rows.reduce((n, r) => n + r.duplicateEmails.length, 0),
      duplicatePhoneCards: rows.reduce((n, r) => n + r.duplicatePhones.reduce((m, g) => m + g.count, 0), 0),
      duplicateEmailCards: rows.reduce((n, r) => n + r.duplicateEmails.reduce((m, g) => m + g.count, 0), 0),
    },
    orphans,
  };
}

/** The human report. Kept separate from the data so tests can assert on either. */
export function formatReport(report) {
  const t = report.totals;
  const lines = [];
  lines.push("Loyalty member report — DRY RUN, nothing is written.");
  if (report.file) lines.push(`File: ${report.file}`);
  lines.push("");
  lines.push(`Programmes: ${t.programs}   Cards: ${t.cards}   With a usable phone: ${t.withPhone}   Without: ${t.withoutPhone}   Old (no member): ${t.oldCards}`);
  lines.push(`Duplicate phones (same programme): ${t.duplicatePhoneGroups} group(s), ${t.duplicatePhoneCards} card(s)`);
  lines.push(`Duplicate emails (same programme): ${t.duplicateEmailGroups} group(s), ${t.duplicateEmailCards} card(s)`);
  if (report.orphans.length) lines.push(`Cards whose programme no longer exists: ${report.orphans.length}`);
  lines.push("");

  if (!report.programs.length) {
    lines.push("No loyalty programmes in this file.");
    return lines.join("\n");
  }
  for (const p of report.programs) {
    lines.push(`${p.name || "(unnamed)"}  [${p.id}]  ${p.status}`);
    lines.push(`  ${p.cards} card(s), ${p.withPhone} with a phone, ${p.withoutPhone} without, ${p.oldCards} old (no member)`);
    if (!p.duplicatePhones.length && !p.duplicateEmails.length) lines.push("  No duplicates.");
    for (const g of p.duplicatePhones) {
      lines.push(`  Phone ${g.key} — ${g.count} cards`);
      for (const c of g.cards) lines.push(`    - ${c.id}  ${c.name || "(no name)"}  ${c.createdAt.slice(0, 10)}`);
    }
    for (const g of p.duplicateEmails) {
      lines.push(`  Email ${g.key} — ${g.count} cards`);
      for (const c of g.cards) lines.push(`    - ${c.id}  ${c.name || "(no name)"}  ${c.createdAt.slice(0, 10)}`);
    }
    lines.push("");
  }
  if (report.orphans.length) {
    lines.push("Cards with no programme:");
    for (const c of report.orphans) lines.push(`  - ${c.id}  ${c.name || "(no name)"}`);
    lines.push("");
  }
  lines.push("To merge, choose the card whose balance should survive (keepId) and the duplicate (mergeId):");
  lines.push("  POST /api/studio/loyalty/programs/<programId>/merge  {keepId, mergeId, confirm:true}");
  lines.push("Both card links keep working; the report never merges anything by itself.");
  return lines.join("\n");
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = arg("--data") ?? process.env.STUDIO_JSON ?? join(process.env.DATA_DIR ?? join(import.meta.dirname, "..", "data"), "studio.json");
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`[loyalty-report] cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const report = { ...reportLoyalty(data), file };
  const out = process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report);
  console.log(out);
}
