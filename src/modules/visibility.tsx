// Plan 8 · CiteRank (AI Visibility): tracks whether ChatGPT, Gemini, Perplexity, Claude and Google AI Overviews
// name a client, in several languages, against competitors; drafts fixes; and runs the live walk-in check.
import { useState } from "react";
import { put, now, useCollection } from "../core/store";
import { EXAMPLE_CLIENTS, EX, dayOffset, example } from "../core/seed";
import { IGIC, eur } from "../core/plans";
import { Badge, Card, ClientPicker, Empty, Page, Tabs } from "../core/ui";
import type { Client, Lang } from "../core/types";
import {
  ENGINES, ONE_OFF, TIERS, VCOL, defaultVisSettings, demoWalkinPlaces, askIn, matches, rng, simulateCheck, OTHERS,
  type Check, type FixPack, type Question, type SpotCheck, type TierName, type VisSettings, type Walkin,
} from "./visibility-data";
import { Overview, QuestionsTab, SourcesTab } from "./visibility-tracker";
import { FixesTab } from "./visibility-fixes";
import { WalkinTab } from "./visibility-walkin";

type TabId = "overview" | "questions" | "sources" | "fixes" | "walkin" | "plans";

export default function Screen() {
  const clients = useCollection<Client>("clients");
  const settings = useCollection<VisSettings>(VCOL.settings);
  const questions = useCollection<Question>(VCOL.questions);
  const checks = useCollection<Check>(VCOL.checks);
  const fixes = useCollection<FixPack>(VCOL.fixes);
  const walkins = useCollection<Walkin>(VCOL.walkins);
  const spots = useCollection<SpotCheck>(VCOL.spot);
  const [tab, setTab] = useState<TabId>("overview");
  const [clientId, setClientId] = useState("");

  const subscribed = clients.filter((c) => c.subs.some((s) => s.plan === "p8") || settings.some((s) => s.clientId === c.id));
  const pickable = [...subscribed, ...clients.filter((c) => !subscribed.includes(c))];
  const client = pickable.find((c) => c.id === clientId) ?? subscribed[0] ?? pickable[0];
  const s: VisSettings | undefined = client
    ? settings.find((x) => x.clientId === client.id) ?? { id: "vset-" + client.id, createdAt: now(), ...defaultVisSettings(client) }
    : undefined;
  const cq = questions.filter((q) => q.clientId === client?.id);
  const cc = checks.filter((x) => x.clientId === client?.id);
  const cf = fixes.filter((x) => x.clientId === client?.id);
  const fixesDone = cf.reduce((a, p) => a + p.items.filter((i) => i.done).length, 0);
  const clientTab = tab !== "walkin" && tab !== "plans";

  return (
    <Page plan="Plan 8 · CiteRank" title="AI Visibility"
      intro="When a tourist asks ChatGPT for the best seafood in Los Cristianos, does it name you? Track it in every language, see who gets named instead, and fix what the AIs read."
      actions={clientTab ? <div style={{ minWidth: 220 }}><ClientPicker id="vis-client" clients={pickable} value={client?.id ?? ""} onChange={setClientId} /></div> : undefined}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Share of voice" },
        { id: "questions", label: "Questions & settings", count: cq.filter((q) => q.active).length },
        { id: "sources", label: "Cited sources" },
        { id: "fixes", label: "Fix pack" },
        { id: "walkin", label: "Walk-in check", count: walkins.length },
        { id: "plans", label: "Plans & pricing" },
      ]} />
      {clientTab && client && s && !client.subs.some((x) => x.plan === "p8") && (
        <div className="banner"><span className="small">{client.name} has no AI Visibility plan yet. Tracking here works as a pilot on the {s.tier} limits.</span><Badge tone="info">Pilot</Badge></div>
      )}
      {clientTab && !client && <Empty>Add a client first, or use the walk-in check for prospects.</Empty>}
      {tab === "overview" && client && s && <Overview client={client} s={s} questions={cq} checks={cc} spots={spots} fixesDone={fixesDone} />}
      {tab === "questions" && client && s && <QuestionsTab key={client.id + (settings.some((x) => x.clientId === client.id) ? s.createdAt : "new")} client={client} s={s} questions={cq} />}
      {tab === "sources" && client && s && <SourcesTab client={client} s={s} checks={cc} />}
      {tab === "fixes" && client && s && <FixesTab key={client.id} client={client} s={s} checks={cc} packs={cf} />}
      {tab === "walkin" && <WalkinTab walkins={walkins} />}
      {tab === "plans" && <PlansTab clients={clients} />}
    </Page>
  );
}

function PlansTab(props: { clients: Client[] }) {
  const on = (t: string) => props.clients.filter((c) => c.subs.some((s) => s.plan === "p8" && s.tier === t));
  return (
    <div className="stack">
      <div className="grid-3">
        {(Object.keys(TIERS) as TierName[]).map((t) => {
          const spec = TIERS[t];
          return (
            <Card key={t} title={t} aside={t === "Add-on" ? <Badge tone="accent">With Maps & Reviews</Badge> : t === "Grow" ? <Badge tone="info">Most useful</Badge> : undefined}>
              <div className="row wrap"><span className="stat-value">{eur(spec.price)}</span><span className="small muted">/month + IGIC = {eur(Math.round(spec.price * (1 + IGIC) * 100) / 100)}</span></div>
              <p className="small">{spec.detail}.</p>
              <div className="stack-sm small muted">
                <span>{spec.questions} questions · {spec.languages} languages · {spec.competitors} competitors</span>
                <span>{spec.cadence === "weekly" ? "Weekly" : "Monthly"} tracking on {ENGINES.length} engines, 3 runs each</span>
                <span>{spec.fixPack ? "Monthly fix pack" : "Report only, fixes on request"}{spec.replies ? " · review replies" : ""}{spec.schema ? " · menu schema" : ""}</span>
              </div>
              <span className="small faint">{on(t).length ? `Clients: ${on(t).map((c) => c.name).join(", ")}` : "No clients on this tier yet"}</span>
            </Card>
          );
        })}
        <Card title="One-off check" aside={<Badge>Door opener</Badge>}>
          <div className="row wrap"><span className="stat-value">{eur(ONE_OFF)}</span><span className="small muted">once + IGIC = {eur(Math.round(ONE_OFF * (1 + IGIC) * 100) / 100)}</span></div>
          <p className="small">"Does ChatGPT recommend you?" Full report in 4 languages against 3 competitors, with the top 5 fixes.</p>
          <span className="small faint">Credit it against the first month if they sign.</span>
        </Card>
      </div>
      <Card title="How to sell it">
        <div className="grid-2">
          <div className="stack-sm small">
            <span className="strong">Pitch</span>
            <span>Walk in with the printed one-page result: "ChatGPT names these 3 places, not you." Offer a free first month.</span>
            <span>Bundle with Maps & Reviews for {eur(TIERS["Add-on"].price)}/month: the fixes overlap, and bundles churn less.</span>
            <span>Annual prepay: 12 months for the price of 10.</span>
            <span>Web designers and holiday-rental managers can resell it for 20% commission.</span>
          </div>
          <div className="stack-sm small">
            <span className="strong">What we never say</span>
            <span>No one controls AI answers. Never promise a ranking or a mention; sell trend tracking and fixes.</span>
            <span>API answers can differ from the consumer apps, so spot-check monthly in the real apps and show both.</span>
            <span>Engines other than Claude are simulated in this app until their API keys are added.</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------- seed ----------

const TASCA_QUESTIONS: [string, Lang][] = [
  ["best seafood restaurant in Los Cristianos", "en"],
  ["where to eat fresh fish in Los Cristianos", "en"],
  ["restaurant with a sea view in Los Cristianos", "en"],
  ["best Canarian food near Los Cristianos harbour", "en"],
  ["bestes Fischrestaurant in Los Cristianos", "de"],
  ["wo isst man frischen Fisch in Los Cristianos", "de"],
  ["Restaurant mit Meerblick Los Cristianos", "de"],
  ["kanarische Küche Los Cristianos Empfehlung", "de"],
];
const TASCA_COMPETITORS = ["Restaurante La Marea", "Bodegón Las Rocas", "El Rincón del Mar"];

export async function seed(): Promise<void> {
  const tasca = EXAMPLE_CLIENTS.find((c) => c.id === EX.tasca)!;
  await put<VisSettings>(VCOL.settings, example("ex-visibility-s-tasca", {
    clientId: tasca.id, tier: "Add-on" as TierName, competitors: TASCA_COMPETITORS, languages: ["en", "de"] as Lang[], aliases: [],
    listedOn: ["google.com/maps", "tripadvisor.com", "tripadvisor.es"], website: "",
    menu: "Pescados | Vieja sancochada con papas y mojo | 16.50 | Parrotfish from the Los Cristianos boats\nPescados | Dorada a la plancha | 18.00 |\nPara compartir | Pulpo a la gallega | 14.00 |\nPara compartir | Croquetas de cherne (6) | 8.50 | Handmade every morning\nPostres | Quesillo | 4.50 | Canarian flan",
  }));
  const qs: Question[] = TASCA_QUESTIONS.map(([text, lang], i) => example(`ex-visibility-q${i + 1}`, { clientId: tasca.id, text, lang, active: true }));
  for (const q of qs) await put(VCOL.questions, q);

  const others = OTHERS.food;
  const plan: [number, number][] = [[-84, 0.1], [-56, 0.16], [-28, 0.27], [-3, 0.36]];
  for (const [i, [day, strength]] of plan.entries()) {
    const date = dayOffset(day);
    const results = simulateCheck(tasca.id, tasca.name, TASCA_COMPETITORS, others, qs, date, strength, ENGINES.map((e) => e.id));
    await put<Check>(VCOL.checks, { ...example(`ex-visibility-c${i + 1}`, { clientId: tasca.id, date, brands: [tasca.name, ...TASCA_COMPETITORS], results, live: false, strength }), createdAt: date + "T09:00:00.000Z" });
  }

  await put<FixPack>(VCOL.fixes, example("ex-visibility-f1", {
    clientId: tasca.id, checkId: "ex-visibility-c3", live: false,
    summary: "Tasca El Puerto is now named in about a quarter of AI answers, up from one in ten in summer. Restaurante La Marea still leads, mostly through German answers that cite HolidayCheck, where Tasca has no listing yet.",
    items: [
      { id: "fx1", kind: "profile", title: "Rewrite the description with the words tourists use", detail: "Open with: 'Seafood restaurant on the Los Cristianos promenade, fish landed the same morning.' Add the English and German versions.", done: true },
      { id: "fx2", kind: "profile", title: "Add the secondary category 'Seafood restaurant'", detail: "Keep 'Restaurant' as primary.", done: true },
      { id: "fx3", kind: "profile", title: "Upload 10 fresh photos", detail: "Dishes, terrace at sunset and the team. Descriptive file names.", done: false },
      { id: "fx4", kind: "faq", lang: "en", title: "Do you serve fresh local fish?", detail: "Yes. Our fish comes from the Los Cristianos boats the same morning. Ask the team for today's catch.", done: true },
      { id: "fx5", kind: "faq", lang: "de", title: "Gibt es frischen Fisch aus der Region?", detail: "Ja, unser Fisch kommt jeden Morgen frisch von den Booten in Los Cristianos. Fragen Sie nach dem Fang des Tages.", done: true },
      { id: "fx6", kind: "faq", lang: "de", title: "Wie kann ich reservieren?", detail: "Rufen Sie uns an oder schreiben Sie per WhatsApp an +34 922 000 101.", done: false },
      { id: "fx7", kind: "directory", title: "holidaycheck.de", detail: "Create the listing: same name, address on the promenade, phone +34 922 000 101, opening hours [CHECK WITH OWNER].", done: false },
      { id: "fx8", kind: "directory", title: "thefork.com", detail: "Claim the listing and fix the old phone number.", done: true },
    ],
  }));

  await put<SpotCheck>(VCOL.spot, example("ex-visibility-sp1", { clientId: tasca.id, date: dayOffset(-3), engine: "chatgpt", question: TASCA_QUESTIONS[0][0], lang: "en", named: true, note: "Named 4th, after La Marea and Las Rocas" }));
  await put<SpotCheck>(VCOL.spot, example("ex-visibility-sp2", { clientId: tasca.id, date: dayOffset(-3), engine: "gemini", question: TASCA_QUESTIONS[4][0], lang: "de", named: false, note: "Lists 5 places, all with HolidayCheck reviews" }));

  const walk: [string, string, string, number][] = [["Bar La Ola", "Puerto de la Cruz", "tapas", -2], ["Pizzería Bella Vista", "Puerto de la Cruz", "pizza", -2], ["Restaurante Brisa Marina", "Los Cristianos", "seafood", -9]];
  for (const [i, [venue, town, category, day]] of walk.entries()) {
    const results = (["en", "de", "nl", "es"] as Lang[]).map((lang) => {
      const places = demoWalkinPlaces(venue, town, category, lang);
      const mentioned = places.some((p) => matches(p.name, venue));
      return {
        lang, question: askIn(lang, category, town), places, mentioned, live: false,
        sim: (["chatgpt", "gemini", "perplexity"] as const).map((engine) => ({ engine, mentioned: rng(`${venue}|${town}|${lang}|${engine}`)() < (mentioned ? 0.6 : 0.18) })),
      };
    });
    await put<Walkin>(VCOL.walkins, { ...example(`ex-visibility-w${i + 1}`, { venue, town, category, results, live: false }), createdAt: dayOffset(day) + "T11:00:00.000Z" });
  }
}
