// AI-drafted fix pack: profile updates, multilingual FAQ, directory cleanup, review replies and menu schema JSON-LD.
import { useState } from "react";
import { aiJson } from "../core/ai";
import { create, put, uid, useCollection } from "../core/store";
import { AiOutput, Badge, Button, Card, CopyButton, Empty, Field, Input, LangTag, TextArea, toast } from "../core/ui";
import type { Client } from "../core/types";
import { COL as RCOL, type Review } from "./reviews-data";
import { draftAndRoute, settingsFor, useSettings } from "./reviews-shared";
import {
  RUNS, TIERS, VCOL, demoFaq, langName, matches, menuSchema, shareOfVoice, sourceTally,
  type Check, type FixItem, type FixPack, type VisSettings,
} from "./visibility-data";

const GROUPS: { kind: FixItem["kind"]; title: string }[] = [
  { kind: "profile", title: "Profile updates" },
  { kind: "faq", title: "Multilingual FAQ" },
  { kind: "directory", title: "Directory cleanup" },
];

interface PackJson { summary: string; profile: { title: string; detail: string }[]; faq: { lang: string; q: string; a: string }[]; directories: { site: string; action: string }[] }

export function FixesTab(props: { client: Client; s: VisSettings; checks: Check[]; packs: FixPack[] }) {
  const { client: c, s } = props;
  const tier = TIERS[s.tier];
  const [busy, setBusy] = useState(false);
  const latest = [...props.checks].sort((a, b) => b.date.localeCompare(a.date))[0];
  const pack = props.packs[0];

  async function generate() {
    if (!latest) return toast("Run a check first.");
    setBusy(true);
    const sov = shareOfVoice(latest, c.name, s.competitors, s.aliases);
    const missed = [...new Map(latest.results.map((r) => [r.questionId, r])).values()].filter((q) =>
      latest.results.filter((r) => r.questionId === q.questionId).every((r) => r.runs.every((run) => !run.named.some((n) => matches(n, c.name, s.aliases)))));
    const gaps = sourceTally(latest).filter((x) => !s.listedOn.includes(x.source)).slice(0, 5);
    const langs = s.languages.length ? s.languages : c.languages;
    const prompt = [
      `You are improving how AI assistants recommend "${c.name}", a ${c.kind} in ${c.town}, Tenerife. Phone ${c.phone}. Languages spoken: ${c.languages.join(", ")}.`,
      c.notes ? `Facts: ${c.notes}` : "",
      `Latest check (${latest.date}, ${RUNS} runs per question per engine): ${sov.map((v) => `${v.brand} ${Math.round(v.share * 100)}% share of voice`).join("; ")}.`,
      missed.length ? `Questions where no engine named the client: ${missed.map((m) => `[${m.lang}] ${m.question}`).join("; ")}` : "",
      gaps.length ? `Sources the AIs cite where the client is missing or wrong: ${gaps.map((g) => `${g.source} (${g.count} citations)`).join(", ")}` : "",
      `Draft a monthly fix pack. Use only the facts given: never invent prices, awards, dishes or opening hours; write [CHECK WITH OWNER] where a fact is needed.`,
      `- profile: 3 to 5 Google Business Profile changes (description wording, categories, attributes, photos, Q&A).`,
      `- faq: 3 questions and answers in each of: ${langs.map(langName).join(", ")}, phrased the way tourists ask AIs.`,
      `- directories: 3 to 5 listing fixes, one per site, starting with the sources above.`,
      `- summary: 2 sentences for the owner, no promises of rankings.`,
      'JSON: {"summary":"...","profile":[{"title":"...","detail":"..."}],"faq":[{"lang":"de","q":"...","a":"..."}],"directories":[{"site":"holidaycheck.de","action":"..."}]}',
    ].filter(Boolean).join("\n");
    const top = sov.slice(1).sort((a, b) => b.share - a.share)[0];
    const demo = (): PackJson => ({
      summary: `${c.name} is named in ${Math.round((sov[0]?.rate ?? 0) * 100)}% of AI answers${top ? `, while ${top.brand} leads with ${Math.round(top.share * 100)}% share of voice` : ""}. This month's fixes focus on the listings the AIs read most and on answers in ${langs.map(langName).join(" and ")}.`,
      profile: [
        { title: "Rewrite the description with the words tourists use", detail: `Name ${c.town}, the type of place (${c.kind.toLowerCase()}) and what you are known for in the first sentence. Add an English and German version via the profile's description update.` },
        { title: "Add a secondary category", detail: `Add the most specific category that fits (for example "Seafood restaurant") next to "${c.kind}".` },
        { title: "Answer 3 questions in Q&A", detail: "Post and answer the FAQ below in the profile's Questions & answers, in English and German." },
        { title: "Upload 10 fresh photos with clear subjects", detail: "Dishes, the terrace and the team. Name the files descriptively before upload." },
      ],
      faq: langs.slice(0, 4).flatMap((l) => demoFaq(c, l).map((f) => ({ lang: l, ...f }))),
      directories: [...gaps.map((g) => g.source), "tripadvisor.com", "thefork.com", "holidaycheck.de"].filter((v, i, a) => a.indexOf(v) === i && !v.includes("google")).slice(0, 4).map((site) => ({
        site, action: `Claim or update the ${c.name} listing: same name, address in ${c.town}, phone ${c.phone}, opening hours [CHECK WITH OWNER], and 5 recent photos.`,
      })),
    });
    try {
      const res = await aiJson<PackJson>(prompt, demo);
      const d = res.data;
      const items: FixItem[] = [
        ...(d.profile ?? []).map((p) => ({ id: uid(), kind: "profile" as const, title: p.title, detail: p.detail, done: false })),
        ...(d.faq ?? []).map((f) => ({ id: uid(), kind: "faq" as const, title: f.q, detail: f.a, lang: f.lang, done: false })),
        ...(d.directories ?? []).map((x) => ({ id: uid(), kind: "directory" as const, title: x.site, detail: x.action, done: false })),
      ];
      await create<FixPack>(VCOL.fixes, { clientId: c.id, checkId: latest.id, summary: d.summary, items, live: res.live });
      toast("Fix pack drafted. Apply items, then tick them off.");
    } finally { setBusy(false); }
  }

  async function toggle(it: FixItem) {
    if (!pack) return;
    await put(VCOL.fixes, { ...pack, items: pack.items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) });
  }

  const done = pack?.items.filter((i) => i.done).length ?? 0;
  return (
    <div className="stack">
      <div className="row wrap between">
        <div className="row wrap">
          <Button kind="primary" busy={busy} onClick={generate} disabled={!latest}>{pack ? "Draft new fix pack" : "Draft fix pack"}</Button>
          {!tier.fixPack && <Badge tone="warn">Fix pack is part of Grow and Pro. Show it as an upsell.</Badge>}
        </div>
        {pack && <span className="small faint">{done} of {pack.items.length} applied</span>}
      </div>
      {!latest && <Empty>Run a check first. The fix pack is built from what the AIs said and which sources they cited.</Empty>}
      {latest && !pack && <Empty>No fix pack yet for {c.name}.</Empty>}
      {pack && (
        <>
          <AiOutput title="For the owner" text={pack.summary} live={pack.live} />
          {pack.items.length > 0 && done > 0 && <div className="bar" aria-label="Progress"><span style={{ width: `${(done / pack.items.length) * 100}%` }} /></div>}
          <div className="grid-2">
            {GROUPS.map((g) => {
              const items = pack.items.filter((i) => i.kind === g.kind);
              if (!items.length) return null;
              return (
                <Card key={g.kind} title={g.title} aside={<span className="small faint">{items.filter((i) => i.done).length}/{items.length}</span>}>
                  {items.map((it) => (
                    <label key={it.id} className="row box" style={{ alignItems: "flex-start" }}>
                      <input type="checkbox" checked={it.done} onChange={() => toggle(it)} style={{ marginTop: 4 }} />
                      <span className="stack-sm">
                        <span className={"row strong" + (it.done ? " faint" : "")}>{it.lang && <LangTag lang={it.lang} />}{it.title}</span>
                        <span className="small muted">{it.detail}</span>
                      </span>
                    </label>
                  ))}
                </Card>
              );
            })}
          </div>
        </>
      )}
      <div className="grid-2">
        <ReplyCard client={c} pro={tier.replies} />
        <SchemaCard client={c} s={s} pro={tier.schema} />
      </div>
    </div>
  );
}

function ReplyCard(props: { client: Client; pro: boolean }) {
  const reviews = useCollection<Review>(RCOL.reviews);
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const open = reviews.filter((r) => r.clientId === props.client.id && r.status === "new");
  async function draft() {
    setBusy(true);
    try { for (const r of open) await draftAndRoute(r, props.client, settingsFor(props.client, settings)); }
    finally { setBusy(false); }
  }
  return (
    <Card title="Review replies" aside={props.pro ? <Badge tone="accent">Included in Pro</Badge> : <Badge tone="warn">Pro</Badge>}>
      <p className="small muted">Answered reviews in many languages are one of the signals AI assistants read. Replies use the Maps & Reviews flow: 4 to 5 stars post, 1 to 3 stars go to the owner first.</p>
      {open.length ? (
        <div className="row wrap between">
          <span className="small"><span className="strong">{open.length}</span> reviews without a reply</span>
          <Button busy={busy} onClick={draft}>Draft and route replies</Button>
        </div>
      ) : <Empty>No unanswered reviews for {props.client.name}. Paste new ones in the Maps & Reviews inbox.</Empty>}
    </Card>
  );
}

const SAMPLE_MENU = "Pescados | Vieja sancochada con papas y mojo | 16.50 | Parrotfish from the Los Cristianos boats\nPescados | Dorada a la plancha | 18.00 |\nPara compartir | Pulpo a la gallega | 14.00 |\nPara compartir | Croquetas de cherne (6) | 8.50 | Handmade every morning\nPostres | Quesillo | 4.50 | Canarian flan";

function SchemaCard(props: { client: Client; s: VisSettings; pro: boolean }) {
  const { client: c, s } = props;
  const [menu, setMenu] = useState(s.menu || SAMPLE_MENU);
  const [site, setSite] = useState(s.website);
  const json = menuSchema(c, site.trim(), menu, ["es", ...c.languages.filter((l) => l !== "es")]);
  return (
    <Card title="Menu schema (JSON-LD)" aside={props.pro ? <Badge tone="accent">Included in Pro</Badge> : <Badge tone="warn">Pro</Badge>}>
      <Field label="Menu lines" hint="Section | Dish | Price | Description. Built from your text only, nothing invented.">
        <TextArea id="sc-menu" rows={5} value={menu} onChange={setMenu} />
      </Field>
      <Field label="Website"><Input id="sc-site" value={site} onChange={setSite} placeholder="https://..." /></Field>
      <div className="ai-out">
        <div className="ai-out-head"><strong>Paste into the website's head</strong><span className="row"><Button small kind="ghost" onClick={async () => { await put(VCOL.settings, { ...s, menu, website: site.trim() }); toast("Menu saved."); }}>Save menu</Button><CopyButton text={json} /></span></div>
        <div className="ai-out-body mono" style={{ maxHeight: 260, overflowY: "auto" }}>{json}</div>
      </div>
      <p className="small faint">Validate with Google's Rich Results Test after publishing.</p>
    </Card>
  );
}
