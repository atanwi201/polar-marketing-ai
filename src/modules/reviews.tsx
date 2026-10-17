// Plan 1 · GBP Autopilot (Maps & Reviews): review inbox and replies in the guest's language,
// owner approval for low ratings, post calendar, profile audit, review QR and monthly report.
import { useState } from "react";
import { put, today, useCollection } from "../core/store";
import { EXAMPLE_CLIENTS, EX, dayOffset, example } from "../core/seed";
import { Badge, ClientPicker, Page, Stat, Stats, Tabs } from "../core/ui";
import type { Client, Task } from "../core/types";
import {
  COL, demoPosts, demoReply, hasP1, shiftMonth,
  type Audit, type LocalEvent, type MenuKit, type Metrics, type MonthlyReport, type Post, type Review, type ReviewSettings,
} from "./reviews-data";
import { Approvals, Inbox } from "./reviews-inbox";
import { Posts } from "./reviews-posts";
import { AuditTab, AUDIT_ITEMS, auditScore } from "./reviews-audit";
import { LinkTab } from "./reviews-link";
import { ReportTab } from "./reviews-report";

type TabId = "inbox" | "approvals" | "posts" | "audit" | "qr" | "report";

export default function Screen() {
  const clients = useCollection<Client>("clients");
  const reviews = useCollection<Review>(COL.reviews);
  const posts = useCollection<Post>(COL.posts);
  const events = useCollection<LocalEvent>(COL.events);
  const audits = useCollection<Audit>(COL.audits);
  const metrics = useCollection<Metrics>(COL.metrics);
  const reports = useCollection<MonthlyReport>(COL.reports);
  const menus = useCollection<MenuKit>(COL.menus);
  const [tab, setTab] = useState<TabId>("inbox");
  const [clientId, setClientId] = useState("");

  const p1 = clients.filter(hasP1).sort((a, b) => a.name.localeCompare(b.name));
  const busiest = [...p1].sort((a, b) => reviews.filter((r) => r.clientId === b.id).length - reviews.filter((r) => r.clientId === a.id).length)[0];
  const focus = p1.find((c) => c.id === clientId) ?? busiest;
  const scoped = reviews.filter((r) => !clientId || r.clientId === clientId);
  const recent = scoped.filter((r) => r.date >= dayOffset(-30));
  const needs = scoped.filter((r) => r.status === "new").length;
  const waiting = scoped.filter((r) => r.status === "awaiting-owner").length;
  const answered = recent.filter((r) => r.status === "auto-posted" || r.status === "posted").length;
  const avg = recent.length ? recent.reduce((a, r) => a + r.rating, 0) / recent.length : 0;
  const langs = new Set(recent.map((r) => r.lang)).size;
  const single = tab === "posts" || tab === "qr" || tab === "report";

  return (
    <Page plan="Plan 1 · GBP Autopilot" title="Maps & Reviews"
      intro="Every Google review answered in the guest's language, fresh posts each month, and numbers the owner cares about: calls and route requests."
      actions={<div style={{ minWidth: 220 }}><ClientPicker id="rv-client" clients={p1} value={clientId} onChange={setClientId} allowNone="All clients" /></div>}>
      <div className="banner">
        <span className="small">Google Business Profile API is not connected yet. Replies and posts go to a manual queue: copy them into the profile, then mark them as posted.</span>
        <Badge tone="warn">Manual queue</Badge>
      </div>
      <Stats>
        <Stat label="Needs reply" value={needs} tone={needs ? "warn" : "good"} sub="Draft and route from the inbox" />
        <Stat label="Waiting for owner" value={waiting} tone={waiting ? "warn" : undefined} sub="1 to 3 star replies" />
        <Stat label="Answered, 30 days" value={`${answered}/${recent.length}`} tone="accent" sub={`${langs} languages`} />
        <Stat label="Average rating, 30 days" value={recent.length ? avg.toFixed(1) : "–"} sub={`${p1.length} clients on this plan`} />
      </Stats>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "inbox", label: "Review inbox", count: needs },
        { id: "approvals", label: "Owner approvals", count: waiting },
        { id: "posts", label: "Posts & calendar" },
        { id: "audit", label: "Profile audit" },
        { id: "qr", label: "Review QR & setup" },
        { id: "report", label: "Monthly report" },
      ]} />
      {single && !clientId && focus && <p className="small faint">Showing {focus.name}. Pick a client at the top to switch.</p>}
      {tab === "inbox" && <Inbox reviews={reviews} clients={clients} clientId={clientId} />}
      {tab === "approvals" && <Approvals reviews={reviews} clients={clients} clientId={clientId} />}
      {tab === "posts" && <Posts client={focus} posts={posts} events={events} menus={menus} />}
      {tab === "audit" && <AuditTab audits={audits} clients={clients} reviews={reviews} />}
      {tab === "qr" && <LinkTab client={focus} />}
      {tab === "report" && <ReportTab client={focus} metrics={metrics} reviews={reviews} posts={posts} reports={reports} />}
    </Page>
  );
}

// ---------- seed ----------

type SeedReview = [id: string, client: string, reviewer: string, rating: number, lang: string, day: number, status: Review["status"], text: string];
const SEED_REVIEWS: SeedReview[] = [
  ["r1", EX.tasca, "Klaus Weber", 2, "de", -1, "new", "Wir haben fast 50 Minuten auf unsere Hauptspeisen gewartet. Der Fisch war dann gut, aber der Service war an diesem Abend völlig überfordert."],
  ["r2", EX.tasca, "Sarah Mitchell", 5, "en", -1, "new", "Best seafood on the Los Cristianos promenade. The grilled dorada was perfect and Marta's team were so friendly. The sunset view from the terrace is a bonus."],
  ["r3", EX.tasca, "Giulia Romano", 4, "it", -6, "auto-posted", "Pesce freschissimo e personale gentile. Un po' di rumore la sera, ma ci torneremo sicuramente."],
  ["r4", EX.tasca, "Pieter de Vries", 3, "nl", -3, "awaiting-owner", "Lekker gegeten, maar de rekening was duur voor wat we kregen. De vis was wel heel vers."],
  ["r5", EX.tasca, "Carmen López", 5, "es", -12, "auto-posted", "Comida casera de verdad, el pescado del día buenísimo y la atención de diez. Volveremos."],
  ["r6", EX.tasca, "Anna Lindqvist", 5, "sv", 0, "new", "Fantastisk mat och trevlig personal. Bästa fisken vi ätit på Teneriffa!"],
  ["r7", EX.tasca, "Thomas Becker", 1, "de", -20, "posted", "Unfreundliche Bedienung, wir wurden ignoriert und sind nach 20 Minuten wieder gegangen."],
  ["r8", EX.tasca, "James O'Connor", 4, "en", -35, "auto-posted", "Great fish and a lovely terrace. Busy on a Saturday, so book ahead."],
  ["r13", EX.tasca, "Hans Müller", 5, "de", -25, "auto-posted", "Sehr leckeres Essen, frischer Fisch und eine tolle Aussicht aufs Meer. Sehr freundlich!"],
  ["r14", EX.tasca, "Lucía Martín", 4, "es", -29, "auto-posted", "Muy buena comida y vistas preciosas. El servicio algo lento pero muy amable."],
  ["r9", EX.whale, "Laura Schmidt", 5, "de", -4, "auto-posted", "Wir haben Grindwale und Delfine aus nächster Nähe gesehen! Die Crew war super nett und hat alles auch auf Deutsch erklärt."],
  ["r10", EX.whale, "Marco Bianchi", 2, "it", -2, "awaiting-owner", "Abbiamo aspettato il pickup in hotel per 40 minuti e nessuno rispondeva al telefono. Le balene comunque bellissime."],
  ["r11", EX.whale, "Emma Clarke", 5, "en", 0, "new", "Saw a huge pod of pilot whales and dolphins. Iván and the crew were brilliant with our kids."],
  ["r12", EX.whale, "Sophie Dubois", 4, "fr", -1, "new", "Belle sortie, nous avons vu des dauphins. Un peu de houle mais l'équipage était rassurant."],
];

function eventDate(md: string): string {
  const t = today();
  const y = Number(t.slice(0, 4));
  return `${md >= t.slice(5) ? y : y + 1}-${md}`;
}

export async function seed(): Promise<void> {
  const byId = new Map(EXAMPLE_CLIENTS.map((c) => [c.id, c]));
  const settings: ReviewSettings[] = [
    example("ex-reviews-s-tasca", { clientId: EX.tasca, voice: "Warm and family-run. Short sentences. Proud of fish landed in Los Cristianos the same morning. Never defensive.",
      signoff: "Marta y el equipo de Tasca El Puerto", ownerWhatsapp: "+34 622 000 101", placeId: "ChIJexampleTascaElPuerto", reviewUrl: "", lastPhotoRefresh: dayOffset(-70) }),
    example("ex-reviews-s-whale", { clientId: EX.whale, voice: "Friendly, outdoorsy, a little excited about the animals. Mention the crew by name only if the guest did.",
      signoff: "Iván & the Atlántico crew", ownerWhatsapp: "+34 622 000 102", placeId: "", reviewUrl: "https://g.page/r/CExampleAtlantico/review" }),
  ];
  for (const s of settings) await put(COL.settings, s);
  const sFor = (cid: string) => settings.find((s) => s.clientId === cid)!;

  const taskIds: Record<string, string> = { r4: "ex-reviews-t1", r10: "ex-reviews-t2" };
  for (const [id, cid, reviewer, rating, lang, day, status, text] of SEED_REVIEWS) {
    const c = byId.get(cid);
    const base = { clientId: cid, reviewer, rating, text, date: dayOffset(day), source: "google" as const, lang, status };
    const d = status === "new" ? undefined : demoReply(base, c, sFor(cid));
    const rec: Review = example("ex-reviews-" + id, {
      ...base,
      ...(d ? { reply: d.reply, replyEs: d.replyEs, sentiment: d.sentiment, topics: d.topics, live: false } : {}),
      ...(status === "auto-posted" || status === "posted" ? { postedAt: dayOffset(day) + "T19:00:00.000Z" } : {}),
      ...(status === "awaiting-owner" ? { taskId: taskIds[id], sentToOwnerAt: dayOffset(day) + "T18:30:00.000Z" } : {}),
    });
    await put(COL.reviews, rec);
    if (taskIds[id] && c) {
      await put<Task>("tasks", example(taskIds[id], {
        title: `Owner approval: reply to ${rating}-star review from ${reviewer} (${c.name})`, module: "reviews", clientId: cid, due: dayOffset(day + 1), done: false,
      }));
    }
  }

  const events: [string, string, string, string?][] = [
    ["10-31", "Halloween night on the promenade", "Los Cristianos"],
    ["11-01", "Los Finaos: chestnuts and new wine", "Tenerife", "Canarian All Saints tradition"],
    ["11-27", "Black Friday weekend", "Costa Adeje"],
    ["11-29", "Noche de San Andrés", "Puerto de la Cruz", "Arrastre de cacharros, new wine tasting"],
    ["11-30", "Fiestas de San Andrés: tablas", "Icod de los Vinos"],
    ["12-08", "Christmas lights switch-on", "Los Cristianos"],
    ["12-31", "New Year's Eve on the beach", "Los Cristianos"],
  ];
  const evRecs: LocalEvent[] = events.map(([md, name, town, note], i) => example(`ex-reviews-e${i + 1}`, { date: eventDate(md), name, town, note }));
  for (const e of evRecs) await put(COL.events, e);

  const tasca = byId.get(EX.tasca)!;
  const month = today().slice(0, 7);
  const drafts = demoPosts(tasca, month, ["Grilled vieja with mojo verde", "Terrace full at sunset", "Marta plating octopus", "Today's catch on ice at the harbour", "Cherne croquettes", "Glass of Tenerife white wine"], evRecs, ["en", "de"], 6);
  for (const [i, p] of drafts.entries()) {
    await put<Post>(COL.posts, example(`ex-reviews-p${i + 1}`, {
      clientId: tasca.id, month, ...p, status: p.date < today() ? "posted" : i % 2 ? "approved" : "draft", live: false,
    }));
  }

  const laOlaItems = AUDIT_ITEMS.map((it) => ({ ...it, ok: ["hours", "contact"].includes(it.id) }));
  const laOlaReview = "Tolle Lage direkt an der Promenade, aber die Pizza kam kalt und wir haben 40 Minuten gewartet.";
  await put<Audit>(COL.audits, example("ex-reviews-a1", {
    venue: "Bar La Ola", town: "Puerto de la Cruz", kind: "Bar", items: laOlaItems, unanswered: 9, rating: 4.1, reviewCount: 212,
    score: auditScore(laOlaItems, 9), sampleReview: laOlaReview, live: false,
    sampleReplyDe: "Vielen Dank für Ihre ehrliche Bewertung. Es tut uns leid, dass die Pizza kalt ankam und Sie so lange warten mussten. An vollen Abenden haben wir jetzt eine zweite Person in der Küche. Wir würden uns freuen, Sie noch einmal auf unserer Terrasse an der Promenade begrüßen zu dürfen.\n\nIhr Team von Bar La Ola",
  }));
  const tascaItems = AUDIT_ITEMS.map((it) => ({ ...it, ok: it.id !== "qa" }));
  await put<Audit>(COL.audits, example("ex-reviews-a2", {
    venue: tasca.name, town: tasca.town, kind: tasca.kind, clientId: tasca.id, items: tascaItems, unanswered: 3, rating: 4.6, reviewCount: 418,
    score: auditScore(tascaItems, 3), live: false,
  }));

  const nums: [string, number, number, number, number, number][] = [
    [EX.tasca, 2100, 3400, 61, 140, 88], [EX.tasca, 2350, 3800, 72, 166, 95], [EX.tasca, 2600, 4300, 84, 191, 112],
    [EX.whale, 1500, 2100, 38, 55, 140], [EX.whale, 1700, 2500, 45, 63, 171], [EX.whale, 1900, 2900, 52, 70, 190],
  ];
  for (const [i, [cid, sv, mv, calls, routes, web]] of nums.entries()) {
    const ym = shiftMonth(month, (i % 3) - 3);
    await put<Metrics>(COL.metrics, example(`ex-reviews-m${i + 1}`, { clientId: cid, month: ym, searchViews: sv, mapsViews: mv, calls, routes, webClicks: web }));
  }
  const last = shiftMonth(month, -1);
  await put<MonthlyReport>(COL.reports, example("ex-reviews-rep1", {
    clientId: EX.tasca, month: last, live: false, sentAt: dayOffset(-12) + "T10:00:00.000Z",
    summary: "Hola Marta, buen mes en Google Maps.\n\n84 personas te llamaron desde el perfil y 191 pidieron cómo llegar, 37 más que el mes anterior. El perfil se vio 6.900 veces entre búsqueda y mapas.\n\nRespondimos todas las reseñas en su idioma (alemán, inglés y español) y la media sigue en 4,6 estrellas. Publicamos 8 posts, los del atardecer en la terraza fueron los más vistos.\n\nPróximo paso: añadir el menú del día en inglés y alemán y responder las preguntas frecuentes del perfil.",
  }));
}
