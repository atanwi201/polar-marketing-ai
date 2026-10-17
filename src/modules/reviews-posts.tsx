// Post generator and monthly post calendar (quota per tier: Basic 4, Plus 8, Pro 12),
// plus the Pro feature: menus and offers in 4 languages.
import { useState } from "react";
import { aiJson, pick } from "../core/ai";
import { create, put, remove, today } from "../core/store";
import {
  AiOutput, Badge, Button, Card, ConfirmButton, Empty, Field, Input, LangPicker, LangTag, Modal, Select, TextArea, fmtDate, toast,
} from "../core/ui";
import type { Client, Lang } from "../core/types";
import {
  COL, demoPosts, langName, monthLabel, p1Tier, postQuota, shiftMonth,
  type LocalEvent, type MenuKit, type Post, type PostDraft,
} from "./reviews-data";

const TOURIST: Lang[] = ["en", "de", "it", "nl", "fr", "sv"];

export function Posts(props: { client?: Client; posts: Post[]; events: LocalEvent[]; menus: MenuKit[] }) {
  const c = props.client;
  const thisMonth = today().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [photos, setPhotos] = useState("");
  const [langs, setLangs] = useState<Lang[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [open, setOpen] = useState<Post | null>(null);
  if (!c) return <Empty>Pick a client with a Maps & Reviews plan at the top of the page.</Empty>;

  const quota = postQuota(c);
  const tourist = langs.length ? langs : (c.languages.filter((l) => l !== "es").slice(0, 2) as Lang[]);
  const monthPosts = props.posts.filter((p) => p.clientId === c.id && p.month === month).sort((a, b) => a.date.localeCompare(b.date));
  const events = props.events.filter((e) => e.date.startsWith(month));
  const remaining = Math.max(0, quota - monthPosts.length);

  async function generate() {
    if (!c) return;
    if (tourist.length > 2) return toast("Pick at most 2 tourist languages. Spanish is always included.");
    setBusy(true);
    const photoList = photos.split("\n").map((s) => s.trim()).filter(Boolean);
    const prompt = [
      `Plan ${remaining} Google Business Profile posts for "${c.name}", a ${c.kind} in ${c.town}, Tenerife, for ${monthLabel(month)} (${month}).`,
      c.notes ? `Facts: ${c.notes}` : "", `Phone: ${c.phone}`,
      photoList.length ? `Photos the owner sent on WhatsApp (use one per post, reuse if needed):\n${photoList.map((p) => "- " + p).join("\n")}` : "No new photos: suggest which existing photo type to use.",
      events.length ? `Local events this month:\n${events.map((e) => `- ${e.date}: ${e.name} (${e.town})${e.note ? ", " + e.note : ""}`).join("\n")}` : "",
      monthPosts.length ? `Already planned on: ${monthPosts.map((p) => p.date).join(", ")}. Avoid those days.` : "",
      "Rules: spread the posts across the month. Tie a post to an event when it is relevant, dated 1 to 3 days before it.",
      `Each post: 50 to 110 words in Spanish first, then adapted (not word-for-word) for tourists in: ${tourist.map(langName).join(", ")}.`,
      "No emoji, no hashtags, no prices or offers that are not in the facts. Google allows one button: cta is BOOK, CALL, LEARN_MORE, ORDER or SIGN_UP.",
      'JSON: {"posts":[{"date":"YYYY-MM-DD","title":"short internal title","photo":"which photo to attach","event":"event name or empty string","cta":"CALL","texts":[{"lang":"es","text":"..."},{"lang":"en","text":"..."}]}]}',
    ].filter(Boolean).join("\n");
    try {
      const res = await aiJson<{ posts: PostDraft[] }>(prompt, () => ({ posts: demoPosts(c, month, photoList, events, tourist, remaining) }));
      for (const p of res.data.posts.slice(0, remaining))
        await create<Post>(COL.posts, { clientId: c.id, month, date: p.date?.startsWith(month) ? p.date : `${month}-15`, title: p.title, photo: p.photo,
          event: p.event || undefined, cta: p.cta, texts: p.texts, status: "draft", live: res.live });
      setLive(res.live);
      toast(`${Math.min(remaining, res.data.posts.length)} posts drafted for ${monthLabel(month)}.`);
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="split">
        <Card title="Generate posts">
          <div className="row wrap">
            <Badge tone="accent">{p1Tier(c) ?? "No tier"} plan</Badge>
            <span className="small muted">{quota} posts a month · {monthPosts.length} planned · {remaining} left</span>
          </div>
          <Field label="Month">
            <Select id="ps-month" value={month} onChange={setMonth}
              options={[0, 1, 2].map((k) => { const m = shiftMonth(thisMonth, k); return { value: m, label: monthLabel(m) }; })} />
          </Field>
          <Field label="What the owner's WhatsApp photos show" hint="One photo per line. The AI writes around what is really in the picture.">
            <TextArea id="ps-photos" rows={4} value={photos} onChange={setPhotos}
              placeholder={"Grilled vieja with mojo verde\nTerrace full at sunset\nMarta plating octopus"} />
          </Field>
          <Field label="Tourist languages (Spanish always included, up to 2)">
            <LangPicker value={tourist} onChange={setLangs} options={TOURIST} />
          </Field>
          <div className="stack-sm">
            <span className="field-label">Local events in {monthLabel(month)}</span>
            {events.length ? events.map((e) => <span key={e.id} className="small">{fmtDate(e.date)} · {e.name} <span className="faint">({e.town})</span></span>)
              : <span className="small faint">No events saved for this month.</span>}
          </div>
          <Button kind="primary" busy={busy} disabled={!remaining} onClick={generate}>
            {remaining ? `Draft ${remaining} posts` : "Monthly quota reached"}
          </Button>
          {live === false && <span className="small faint">Demo drafts. With AI on, posts are written from your photos and events.</span>}
        </Card>
        <Card title={`Post calendar · ${monthLabel(month)}`} aside={<span className="small faint">Click a post to review it</span>}>
          <Calendar month={month} posts={monthPosts} events={events} onOpen={setOpen} />
          {monthPosts.length === 0 && <Empty>No posts planned for {monthLabel(month)} yet. Describe the photos and draft them.</Empty>}
          {monthPosts.length > 0 && (
            <div className="stack-sm">
              {monthPosts.map((p) => (
                <button key={p.id} type="button" className="box row between" style={{ cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }} onClick={() => setOpen(p)}>
                  <span className="row wrap"><span className="mono small">{p.date.slice(8)}</span><span className="strong">{p.title}</span>
                    {p.texts.map((t) => <LangTag key={t.lang} lang={t.lang} />)}</span>
                  <PostStatus s={p.status} />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
      <EventsCard events={props.events} town={c.town} />
      <MenuCard client={c} menus={props.menus.filter((m) => m.clientId === c.id)} />
      <PostModal post={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function PostStatus(props: { s: Post["status"] }) {
  return props.s === "posted" ? <Badge tone="good">Posted</Badge> : props.s === "approved" ? <Badge tone="info">Approved</Badge> : <Badge>Draft</Badge>;
}

function Calendar(props: { month: string; posts: Post[]; events: LocalEvent[]; onOpen: (p: Post) => void }) {
  const [y, m] = props.month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="small faint" style={{ textAlign: "center" }}>{d}</div>)}
      {cells.map((d, i) => {
        if (d == null) return <div key={"x" + i} />;
        const iso = `${props.month}-${String(d).padStart(2, "0")}`;
        const ps = props.posts.filter((p) => p.date === iso);
        const ev = props.events.find((e) => e.date === iso);
        return (
          <div key={iso} className="box" style={{ padding: 4, minHeight: 54 }} title={ev?.name}>
            <div className="row between"><span className="small mono">{d}</span>{ev && <span className="small" style={{ color: "var(--warn)" }} aria-label={ev.name}>●</span>}</div>
            {ps.map((p) => (
              <button key={p.id} type="button" onClick={() => props.onOpen(p)} className={"chip" + (p.status === "posted" ? " chip-on" : "")}
                style={{ display: "block", width: "100%", marginTop: 2, fontSize: ".66rem", padding: "1px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.title}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PostModal(props: { post: Post | null; onClose: () => void }) {
  const p = props.post;
  const [edit, setEdit] = useState<Record<string, string>>({});
  if (!p) return null;
  const textOf = (l: string, t: string) => edit[l] ?? t;
  const texts = p.texts.map((t) => ({ lang: t.lang, text: textOf(t.lang, t.text) }));
  const save = async (status: Post["status"]) => {
    await put(COL.posts, { ...p, texts, status });
    toast(status === "posted" ? "Marked as posted (Google not connected yet)." : status === "approved" ? "Approved for posting." : "Saved.");
    setEdit({}); props.onClose();
  };
  return (
    <Modal open title={p.title} onClose={() => { setEdit({}); props.onClose(); }}
      footer={<>
        <ConfirmButton label="Delete" confirm="Delete post" onConfirm={async () => { await remove(COL.posts, p.id); props.onClose(); }} />
        <Button onClick={() => save(p.status)}>Save</Button>
        {p.status === "draft" && <Button onClick={() => save("approved")}>Approve</Button>}
        <Button kind="primary" onClick={() => save("posted")}>Mark as posted</Button>
      </>}>
      <div className="row wrap"><PostStatus s={p.status} /><span className="small muted">{fmtDate(p.date)} · Button: {p.cta.replace("_", " ").toLowerCase()}</span>
        {p.event && <Badge tone="warn">{p.event}</Badge>}<Badge tone={p.live ? "accent" : "neutral"}>{p.live ? "AI draft" : "Demo draft"}</Badge></div>
      <div className="box small"><span className="strong">Photo: </span>{p.photo}</div>
      {p.texts.map((t) => (
        <Field key={t.lang} label={langName(t.lang)}>
          <TextArea id={`pm-${p.id}-${t.lang}`} rows={4} value={textOf(t.lang, t.text)} onChange={(v) => setEdit({ ...edit, [t.lang]: v })} />
        </Field>
      ))}
      <p className="small faint">Google Business Profile API is not connected yet. Copy each text into the profile, then mark the post as posted.</p>
    </Modal>
  );
}

function EventsCard(props: { events: LocalEvent[]; town: string }) {
  const [f, setF] = useState({ date: "", name: "", town: props.town });
  const upcoming = props.events.filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card title="Local events calendar" aside={<span className="small faint">Feeds the post agent</span>}>
      <div className="form-grid">
        <Field label="Date"><Input id="ev-date" type="date" value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label="Event"><Input id="ev-name" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Fiestas de San Andrés" /></Field>
        <Field label="Town"><Input id="ev-town" value={f.town} onChange={(v) => setF({ ...f, town: v })} /></Field>
        <Button onClick={async () => {
          if (!f.date || !f.name.trim()) return toast("Add a date and a name.");
          await create<LocalEvent>(COL.events, { date: f.date, name: f.name.trim(), town: f.town.trim() || "Tenerife" });
          setF({ date: "", name: "", town: props.town });
        }}>Add event</Button>
      </div>
      {upcoming.length ? (
        <div className="stack-sm">
          {upcoming.slice(0, 8).map((e) => (
            <div key={e.id} className="row between small">
              <span><span className="mono">{e.date}</span> · <span className="strong">{e.name}</span> <span className="faint">{e.town}{e.note ? ` · ${e.note}` : ""}</span></span>
              <ConfirmButton label="Remove" confirm="Remove" onConfirm={() => remove(COL.events, e.id)} />
            </div>
          ))}
        </div>
      ) : <Empty>No upcoming events. Add fiestas, markets and concerts so posts feel local.</Empty>}
    </Card>
  );
}

const SAMPLE_MENU = "Menú del día 14,50 €: sopa de pescado, vieja sancochada con papas y mojo, y quesillo. Bebida incluida. De lunes a viernes, de 13:00 a 16:00.";
const SAMPLE_OUT: Record<string, string> = {
  en: "Menu of the day €14.50: fish soup, poached parrotfish with Canarian potatoes and mojo, and quesillo (Canarian flan). Drink included. Monday to Friday, 1 pm to 4 pm.",
  de: "Tagesmenü 14,50 €: Fischsuppe, gekochter Papageifisch mit kanarischen Kartoffeln und Mojo, dazu Quesillo (kanarischer Flan). Getränk inklusive. Montag bis Freitag, 13 bis 16 Uhr.",
  it: "Menù del giorno 14,50 €: zuppa di pesce, pesce pappagallo lessato con patate canarie e mojo, e quesillo (flan canario). Bevanda inclusa. Dal lunedì al venerdì, dalle 13 alle 16.",
  nl: "Dagmenu € 14,50: vissoep, gekookte papegaaivis met Canarische aardappeltjes en mojo, en quesillo (Canarische flan). Drankje inbegrepen. Maandag tot vrijdag, 13.00 tot 16.00 uur.",
  fr: "Menu du jour 14,50 € : soupe de poisson, poisson-perroquet poché avec pommes de terre canariennes et mojo, et quesillo (flan canarien). Boisson comprise. Du lundi au vendredi, de 13 h à 16 h.",
  sv: "Dagens meny 14,50 €: fisksoppa, kokt papegojfisk med kanariska potatisar och mojo, och quesillo. Dryck ingår. Måndag till fredag 13–16.",
};

function MenuCard(props: { client: Client; menus: MenuKit[] }) {
  const c = props.client;
  const pro = p1Tier(c) === "Pro";
  const [src, setSrc] = useState(SAMPLE_MENU);
  const [langs, setLangs] = useState<Lang[]>(["en", "de", "it", "nl"]);
  const [busy, setBusy] = useState(false);
  const latest = props.menus[0];

  async function run() {
    if (langs.length === 0) return toast("Pick at least one language.");
    setBusy(true);
    try {
      const res = await aiJson<{ out: { lang: string; text: string }[] }>(
        [`Translate this Spanish menu or offer from "${c.name}" (${c.kind}, ${c.town}, Tenerife) for tourists.`,
          `Languages: ${langs.map(langName).join(", ")}. Keep every price, time and dish exactly; explain Canarian dish names briefly in brackets the first time. No emoji.`,
          `Text: """${src}"""`, 'JSON: {"out":[{"lang":"en","text":"..."}]}'].join("\n"),
        () => ({ out: langs.map((l) => ({ lang: l, text: src.trim() === SAMPLE_MENU ? SAMPLE_OUT[l] ?? SAMPLE_OUT.en : `[Demo: connect AI to translate] ${src}` })) }),
        { tier: "quick" });
      await create<MenuKit>(COL.menus, { clientId: c.id, source: src, langs, out: res.data.out, live: res.live });
    } finally { setBusy(false); }
  }

  return (
    <Card title="Menus and offers in 4 languages" aside={pro ? <Badge tone="accent">Included in Pro</Badge> : <Badge tone="warn">Pro feature · upsell</Badge>}>
      <div className="grid-2">
        <div className="stack">
          <Field label="Menu or offer in Spanish"><TextArea id="mn-src" rows={4} value={src} onChange={setSrc} /></Field>
          <LangPicker value={langs} onChange={setLangs} options={TOURIST} />
          <div><Button kind="primary" busy={busy} onClick={run}>Translate</Button></div>
        </div>
        <div className="stack">
          {latest ? latest.out.map((o) => <AiOutput key={o.lang} title={langName(o.lang)} text={o.text} live={latest.live} />)
            : <Empty>Translations show here and are saved for the profile's menu and offer posts.</Empty>}
        </div>
      </div>
      {!pro && <p className="small faint">{pick(["Menus in 4 languages come with Pro (€249/month).", "Upgrade to Pro (€249/month) to include monthly menu updates in 4 languages."], c.id)}</p>}
    </Card>
  );
}
