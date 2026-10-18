// Plan 6 · AI WhatsApp booking receptionist.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Tabs, Badge, Empty, ClientPicker, LangPicker, LangTag, ConfirmButton, toast,
} from "../core/ui";
import { useCollection, put, today } from "../core/store";
import { aiJson } from "../core/ai";
import { LANGS, eur } from "../core/plans";
import { EX, example, dayOffset } from "../core/seed";
import type { Client, Lang, Task } from "../core/types";
import {
  type Bot, type Booking, type Block, type Chat, type Handoff, type Msg, type Turn, type QState, type ChannelId, type Trip, type Zone, type Faq, type MText,
  ruleRespond, livePrompt, availabilityText, cleanState, slotInfo, replyLang, reminderLine, T, fmtDay, type Ctx,
} from "./receptionist-engine";
import { WHALE_BOT, DIVE_BOT, blankBot } from "./receptionist-data";
import { COL, tierOf, LANG_LIMIT, CHANNEL_LABEL, bookFromState, openHandoff, stamp, hhmm, type Audit } from "./receptionist-shared";
import { BookingsView, CalendarView, HandoffsView, ChannelsView, ReportView, AuditView } from "./receptionist-views";

type TabId = "chat" | "setup" | "bookings" | "calendar" | "handoffs" | "channels" | "report" | "audit";

export default function Screen() {
  const clients = useCollection<Client>("clients");
  const bots = useCollection<Bot>(COL.bots);
  const bookings = useCollection<Booking>(COL.bookings);
  const blocks = useCollection<Block>(COL.blocks);
  const chats = useCollection<Chat>(COL.chats);
  const handoffs = useCollection<Handoff>(COL.handoffs);
  const [tab, setTab] = useState<TabId>("chat");
  const [clientId, setClientId] = useState("");

  const sorted = useMemo(() => {
    const withBot = new Set(bots.map((b) => b.clientId));
    return [...clients].sort((a, b) => Number(withBot.has(b.id)) - Number(withBot.has(a.id)) || a.name.localeCompare(b.name));
  }, [clients, bots]);
  useEffect(() => {
    if (!clientId && sorted.length) setClientId(sorted[0].id);
  }, [sorted, clientId]);

  const client = clients.find((c) => c.id === clientId);
  const bot = bots.find((b) => b.clientId === clientId);
  const mine = <T extends { clientId: string }>(xs: T[]) => xs.filter((x) => x.clientId === clientId);
  const openHandoffs = mine(handoffs).filter((h) => h.status === "open").length;
  const upcoming = mine(bookings).filter((b) => b.date >= today() && b.status !== "cancelled" && b.status !== "weather-cancelled").length;

  return (
    <Page
      plan="Plan 6 · WhatsApp Receptionist"
      title="AI booking receptionist"
      intro="Answers WhatsApp, Instagram, web and Google enquiries in the guest's language, only from the operator's approved data. It qualifies, checks seats, books with a payment link, schedules reminders and hands tricky chats to the owner."
      actions={clients.length ? <ClientPicker id="rc-client" clients={sorted} value={clientId} onChange={setClientId} /> : undefined}
    >
      {!clients.length && <Empty>Add a client first. Each tour, dive or surf operator gets its own bot.</Empty>}
      {client && (
        <>
          <Tabs<TabId>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "chat", label: "Chat simulator" },
              { id: "setup", label: "Bot setup" },
              { id: "bookings", label: "Bookings", count: upcoming },
              { id: "calendar", label: "Availability" },
              { id: "handoffs", label: "Handoff inbox", count: openHandoffs },
              { id: "channels", label: "Channels" },
              { id: "report", label: "Weekly report" },
              { id: "audit", label: "Missed enquiries audit" },
            ]}
          />
          {tab !== "audit" && !bot && tab !== "setup" ? (
            <NoBot client={client} onCreate={() => setTab("setup")} />
          ) : (
            <>
              {tab === "chat" && bot && <Simulator key={client.id} bot={bot} client={client} bookings={bookings} blocks={blocks} chats={mine(chats)} />}
              {tab === "setup" && <Setup key={client.id} bot={bot} client={client} />}
              {tab === "bookings" && bot && <BookingsView bot={bot} client={client} bookings={mine(bookings)} />}
              {tab === "calendar" && bot && <CalendarView bot={bot} client={client} bookings={bookings} blocks={blocks} />}
              {tab === "handoffs" && bot && <HandoffsView bot={bot} client={client} handoffs={mine(handoffs)} chats={chats} />}
              {tab === "channels" && bot && <ChannelsView bot={bot} client={client} chats={mine(chats)} />}
              {tab === "report" && bot && <ReportView bot={bot} client={client} chats={mine(chats)} bookings={mine(bookings)} handoffs={mine(handoffs)} />}
              {tab === "audit" && <AuditView />}
            </>
          )}
        </>
      )}
    </Page>
  );
}

function NoBot(props: { client: Client; onCreate: () => void }) {
  return (
    <Empty action={<Button kind="primary" onClick={props.onCreate}>Set up a bot</Button>}>
      {props.client.name} has no receptionist bot yet. Set up trips, prices, rules and pickup zones first. The bot answers only from that data.
    </Empty>
  );
}

export function PolicyNote(props: { biz: string }) {
  return (
    <div className="banner small">
      <span>
        <strong>Meta policy:</strong> this bot only handles {props.biz} support and bookings. General-purpose questions are declined.
        Replies inside the 24-hour customer window are free; reminders go out as approved utility templates.
      </span>
    </div>
  );
}

/* ---------- Chat simulator ---------- */

const SAMPLES: { label: string; text: string }[] = [
  { label: "EN booking", text: "Hi! How much is it for 2 adults and 1 child tomorrow afternoon?" },
  { label: "DE booking", text: "Hallo, wir sind zwei Erwachsene. Habt ihr am Samstag um 10 Uhr noch Plätze?" },
  { label: "IT booking", text: "Ciao! Siamo in 4, vorremmo prenotare per domenica alle 14" },
  { label: "ES booking", text: "Hola, ¿cuánto cuesta? Somos 3 adultos para pasado mañana por la mañana" },
  { label: "FAQ", text: "Will we see dolphins? And what should we bring?" },
  { label: "Handoff", text: "Do you have a group discount? One of us uses a wheelchair." },
  { label: "Off-topic", text: "Can you write me a poem about Tenerife?" },
];
const GUESTS = [
  { name: "Sophie Wagner", phone: "+49 151 2233 4455" },
  { name: "Giulia Romano", phone: "+39 347 555 1290" },
  { name: "Tom Hughes", phone: "+44 7700 900 412" },
  { name: "Lucía Ortega", phone: "+34 611 482 907" },
];
const VALID_LANGS = Object.keys(LANGS) as Lang[];

interface LiveTurn { lang?: string; reply?: string; state?: Partial<Record<keyof QState, unknown>>; action?: string; handoffReason?: string; summary?: string }

function Simulator(props: { bot: Bot; client: Client; bookings: Booking[]; blocks: Block[]; chats: Chat[] }) {
  const { bot, client, bookings, blocks, chats } = props;
  const [chatId, setChatId] = useState<string>(chats[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [guest, setGuest] = useState(GUESTS[0]);
  const [channel, setChannel] = useState<ChannelId>("whatsapp");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = chats.find((c) => c.id === chatId);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat?.messages.length, busy]);

  function newChat() {
    setChatId("");
    setGuest(GUESTS[(GUESTS.indexOf(guest) + 1) % GUESTS.length]);
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    const started = Date.now();
    const base: Chat = chat ?? {
      id: "chat-" + Date.now().toString(36), createdAt: stamp(), clientId: client.id, channel,
      guestName: guest.name, guestPhone: guest.phone, messages: [], state: {}, status: "open",
    };
    let c: Chat = { ...base, messages: [...base.messages, { from: "guest", text, at: stamp() }] };
    await put(COL.chats, c);
    setChatId(c.id);

    const ctx: Ctx = { bot, bizName: client.name, bookings, blocks, chat: c, text, today: today() };
    const res = await aiJson<Turn | LiveTurn>(livePrompt(ctx, availabilityText(bot, bookings, blocks, today())), () => ruleRespond(ctx), { tier: "quick" });
    const turn = res.live ? fromLive(res.data as LiveTurn, ctx) : (res.data as Turn);
    const l = replyLang(turn.lang, bot);
    const notes: Msg[] = [];
    let reply = turn.reply;
    let state = turn.state;
    let status: Chat["status"] = c.status === "booked" ? "open" : c.status;
    let bookingId = c.bookingId;

    if (turn.action === "book") {
      const b = await bookFromState({ bot, client, chat: c, state, lang: turn.lang, bookings, blocks });
      if (typeof b === "string") {
        reply = b === "full" ? T[l].full(fmtDay(state.date ?? today(), l), state.time ?? "", []) : reply || T[l].change;
        state = { ...state, time: b === "full" ? undefined : state.time, lastAsk: b === "full" ? "time" : state.lastAsk };
      } else {
        reply = [reply, T[l].booked(b.code, b.paymentLink, reminderLine(l, b.reminders))].filter(Boolean).join("\n\n");
        notes.push({ from: "note", at: stamp(), text: `Booking ${b.code} created: ${b.adults + b.children} seats on ${b.date} ${b.time}, ${eur(b.total)}. Payment link sent (simulated, Stripe not connected). ${b.reminders.length} reminder${b.reminders.length === 1 ? "" : "s"} scheduled.` });
        state = {};
        status = "booked";
        bookingId = b.id;
      }
    }
    if (turn.action === "handoff") {
      const h = await openHandoff({ client, chat: c, lang: turn.lang, reason: turn.handoffReason ?? "Needs the owner", summary: turn.summary ?? "", live: res.live });
      notes.push({ from: "note", at: stamp(), text: `Handed off to ${bot.handoffPhone || "the owner"} with a summary. Task created on Today. (${h.reason})` });
      status = "handoff";
    }
    const secs = Math.max(2, Math.round((Date.now() - started) / 1000));
    c = {
      ...c, lang: turn.lang, state, status, bookingId, live: res.live,
      firstResponseSec: c.firstResponseSec ?? secs,
      messages: [...c.messages, { from: "bot", text: reply, at: stamp() }, ...notes],
    };
    await put(COL.chats, c);
    if (res.error) toast(res.error);
    setBusy(false);
  }

  const s = chat?.state ?? {};
  const trip = bot.trips.find((t) => t.id === s.tripId);
  const slot = trip && s.date && s.time ? slotInfo(bot, bookings, blocks, trip.id, s.date, s.time) : undefined;

  return (
    <div className="stack">
      <PolicyNote biz={client.name} />
      {!bot.active && <div className="banner small"><span>This bot is paused for live guests. The simulator still works so you can test changes.</span></div>}
      <div className="split">
        <div className="stack">
          <Card title="Test as a tourist">
            {chat ? (
              <div className="stack-sm">
                <span className="row wrap"><strong>{chat.guestName}</strong><span className="faint small">{chat.guestPhone}</span>{chat.lang && <LangTag lang={chat.lang} />}</span>
                <span className="small muted">{CHANNEL_LABEL[chat.channel]} · started {hhmm(chat.createdAt)}</span>
                <Button small onClick={newChat}>New conversation</Button>
              </div>
            ) : (
              <div className="form-grid">
                <Field label="Guest">
                  <Select id="rc-guest" value={guest.name} onChange={(v) => setGuest(GUESTS.find((g) => g.name === v) ?? GUESTS[0])} options={GUESTS.map((g) => g.name)} />
                </Field>
                <Field label="Channel">
                  <Select<ChannelId> id="rc-channel" value={channel} onChange={setChannel}
                    options={(Object.keys(CHANNEL_LABEL) as ChannelId[]).map((k) => ({ value: k, label: CHANNEL_LABEL[k] }))} />
                </Field>
              </div>
            )}
            <div className="stack-sm">
              <span className="small muted">Try a message in any language</span>
              <div className="chips">
                {SAMPLES.map((x) => <button key={x.label} type="button" className="chip" onClick={() => setDraft(x.text)}>{x.label}</button>)}
              </div>
            </div>
          </Card>
          <Understood chat={chat} trip={trip} slot={slot} bot={bot} />
          <Card title="Recent conversations">
            {chats.length ? (
              <div className="stack-sm">
                {chats.slice(0, 8).map((x) => (
                  <button key={x.id} type="button" className={"chip" + (x.id === chatId ? " chip-on" : "")} style={{ textAlign: "left", borderRadius: "var(--radius-md)" }} onClick={() => setChatId(x.id)}>
                    {x.guestName} · {x.lang?.toUpperCase() ?? "?"} · {x.status}
                  </button>
                ))}
              </div>
            ) : <p className="small muted">No conversations yet.</p>}
          </Card>
        </div>
        <Card title={<span className="row">{client.name}<Badge tone={bot.active ? "good" : "warn"}>{bot.active ? "Bot on" : "Paused"}</Badge></span>}
          aside={chat && <Badge tone={chat.status === "handoff" ? "warn" : chat.status === "booked" ? "good" : "info"}>{chat.status}</Badge>}>
          <div className="chat" ref={scrollRef} aria-live="polite">
            {!chat?.messages.length && <p className="faint small" style={{ alignSelf: "center", marginTop: 80 }}>Type as a tourist below. The assistant answers from {client.name}'s data only.</p>}
            {chat?.messages.map((m, i) => <Bubble key={i} m={m} live={!!chat.live} owner={client.contact} />)}
            {busy && <div className="bubble bubble-out faint">typing…</div>}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <Input id="rc-msg" value={draft} onChange={setDraft} placeholder="Message as the guest, e.g. Wir sind 4 Personen am Freitag" />
            <Button type="submit" kind="primary" busy={busy} disabled={!draft.trim()}>Send</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Bubble(props: { m: Msg; live: boolean; owner: string }) {
  const { m } = props;
  if (m.from === "note") return <div className="small faint" style={{ alignSelf: "center", textAlign: "center", maxWidth: "90%" }}>{m.text}</div>;
  const who = m.from === "guest" ? "Guest" : m.from === "owner" ? `${props.owner} (owner)` : props.live ? "Assistant · AI" : "Assistant · demo responder";
  return (
    <div className={"bubble " + (m.from === "guest" ? "bubble-in" : "bubble-out")}>
      {m.text}
      <div className="bubble-meta">{who} · {hhmm(m.at)}</div>
    </div>
  );
}

function Understood(props: { chat?: Chat; trip?: Trip; slot?: { left: number; cap: number; block?: Block }; bot: Bot }) {
  const { chat, trip, slot } = props;
  const s = chat?.state ?? {};
  const rows: [string, ReactNode][] = [
    ["Language", chat?.lang ? <span className="row"><LangTag lang={chat.lang} />{LANGS[chat.lang]}</span> : "–"],
    ["Trip", trip?.name ?? "–"],
    ["Date", s.date ? fmtDay(s.date, "en") : "–"],
    ["Time", s.time ?? "–"],
    ["Group", s.adults != null ? `${s.adults} adult${s.adults === 1 ? "" : "s"}${s.children ? `, ${s.children} ${s.children === 1 ? "child" : "children"}` : ""}` : "–"],
    ["Pickup", s.zone ? `${s.hotel ? s.hotel + ", " : ""}${s.zone}` : s.noPickup ? "Meets at harbour" : s.hotel ?? "–"],
    ["Seats", slot ? (slot.block ? `Cancelled: ${slot.block.reason}` : `${slot.left} of ${slot.cap} left`) : "–"],
    ["Next step", s.lastAsk ? `Asking for ${s.lastAsk}` : chat?.status === "booked" ? "Booked" : chat?.status === "handoff" ? "With the owner" : "–"],
  ];
  return (
    <Card title="What the assistant understood">
      <div className="stack-sm small">
        {rows.map(([k, v]) => <div key={k} className="row between"><span className="muted">{k}</span><span className="strong">{v}</span></div>)}
      </div>
    </Card>
  );
}

function fromLive(d: LiveTurn, ctx: Ctx): Turn {
  const lang = VALID_LANGS.includes(d.lang as Lang) ? (d.lang as Lang) : ctx.chat.lang ?? "en";
  const action = d.action === "book" || d.action === "handoff" ? d.action : "none";
  const state = cleanState(d.state, ctx.bot, ctx.chat.state);
  const reply = typeof d.reply === "string" && d.reply.trim() ? d.reply.trim() : T[replyLang(lang, ctx.bot)].handoff(ctx.bot.handoffPhone, ctx.bot.handoffHours);
  return {
    lang, action, state, reply,
    handoffReason: d.handoffReason || (action === "handoff" ? "The assistant was not sure" : undefined),
    summary: d.summary || undefined,
  };
}

/* ---------- Bot setup ---------- */

function Setup(props: { bot?: Bot; client: Client }) {
  const { client } = props;
  const [draft, setDraft] = useState<Bot | null>(props.bot ? structuredClone(props.bot) : null);
  const tier = tierOf(client);
  useEffect(() => { if (props.bot && !draft) setDraft(structuredClone(props.bot)); }, [props.bot]);

  if (!draft) {
    return (
      <Empty action={<Button kind="primary" onClick={() => setDraft({ ...blankBot(client.id), id: "bot-" + client.id, createdAt: stamp() })}>Start from template</Button>}>
        No bot for {client.name} yet. Collect their trips, prices, times, capacity, weather and cancellation rules, pickup zones and FAQ during onboarding.
      </Empty>
    );
  }
  const d = draft;
  const set = (patch: Partial<Bot>) => setDraft({ ...d, ...patch });
  const dirty = JSON.stringify(d) !== JSON.stringify(props.bot ?? null);
  const extraLangs = d.languages.filter((l) => l !== "en");
  const limit = LANG_LIMIT[tier];

  async function save() {
    const problems: string[] = [];
    if (!d.trips.length) problems.push("add at least one trip");
    if (!d.handoffPhone.trim()) problems.push("add a handoff phone");
    if (d.trips.some((t) => !t.times.length || t.capacity < 1)) problems.push("every trip needs times and capacity");
    if (problems.length) { toast("Before saving: " + problems.join(", ") + "."); return; }
    await put(COL.bots, d);
    toast("Bot saved. The assistant now answers from this data.");
  }

  return (
    <div className="stack">
      <PolicyNote biz={client.name} />
      <Card title={`Bot for ${client.name}`} aside={<>
        <Badge tone="info">{tier} plan</Badge>
        <label className="row small"><input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} /> Live for guests</label>
        {dirty && <Button small kind="ghost" onClick={() => setDraft(props.bot ? structuredClone(props.bot) : null)}>Discard</Button>}
        <Button small kind="primary" onClick={save} disabled={!dirty}>Save</Button>
      </>}>
        <div className="form-grid">
          <Field label="Handoff phone (owner's WhatsApp)"><Input id="rc-phone" value={d.handoffPhone} onChange={(v) => set({ handoffPhone: v })} placeholder="+34 6.." /></Field>
          <Field label="Owner reply hours"><Input id="rc-hours" value={d.handoffHours} onChange={(v) => set({ handoffHours: v })} /></Field>
          <Field label="Meeting point"><Input id="rc-meet" value={d.meetingPoint} onChange={(v) => set({ meetingPoint: v })} /></Field>
          <Field label="Response time before the bot (min)" hint="From the audit, for the weekly report"><Input id="rc-base" type="number" min={0} value={d.baselineResponseMin} onChange={(v) => set({ baselineResponseMin: Number(v) || 0 })} /></Field>
          <Field label={`Languages (${tier}: up to ${limit})`} wide hint={d.languages.length > limit ? `Over the ${tier} limit. Upgrade or remove a language.` : "The assistant detects the guest's language and replies in it when listed here, otherwise in English."}>
            <LangPicker value={d.languages} onChange={(v) => set({ languages: v.includes("en") ? v : ["en", ...v] })} />
          </Field>
        </div>
      </Card>

      <TripsEditor trips={d.trips} onChange={(trips) => set({ trips })} />
      <ZonesEditor zones={d.zones} onChange={(zones) => set({ zones })} />

      <Card title="Weather and cancellation rules" aside={<span className="small faint">English is the approved source. Translations feed the demo responder; live AI translates on the fly.</span>}>
        <div className="grid-2">
          <MTextEditor id="rc-weather" label="Weather rule" value={d.weatherRule} langs={extraLangs} onChange={(weatherRule) => set({ weatherRule })} />
          <MTextEditor id="rc-cancel" label="Cancellation rule" value={d.cancellationRule} langs={extraLangs} onChange={(cancellationRule) => set({ cancellationRule })} />
        </div>
      </Card>

      <FaqEditor faq={d.faq} langs={extraLangs} onChange={(faq) => set({ faq })} />

      <Card title="Reminders">
        <div className="form-grid">
          <Field label="Reminder hours before the trip" hint="Comma separated, e.g. 24, 2">
            <Input id="rc-rem" value={d.reminderHours.join(", ")} onChange={(v) => set({ reminderHours: v.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} />
          </Field>
          <label className="row small"><input type="checkbox" checked={d.reviewRequest} onChange={(e) => set({ reviewRequest: e.target.checked })} /> Ask for a Google review the day after {tier !== "Multi" && <Badge tone="warn">Multi plan</Badge>}</label>
        </div>
        <div className="box small pre">{`Utility template "trip_reminder" (EN):
Hi {{1}}, a reminder for your ${d.trips[0]?.name ?? "trip"} on {{2}} at {{3}}. Pickup: {{4}}. Reply here if anything changes.

Plantilla (ES): Hola {{1}}, te recordamos tu ${d.trips[0]?.name ?? "excursión"} el {{2}} a las {{3}}. Recogida: {{4}}. Responde aquí si cambia algo.`}</div>
      </Card>
    </div>
  );
}

function TripsEditor(props: { trips: Trip[]; onChange: (t: Trip[]) => void }) {
  const upd = (i: number, patch: Partial<Trip>) => props.onChange(props.trips.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <Card title="Trips, times, prices and capacity" aside={<Button small onClick={() => props.onChange([...props.trips, { id: "trip" + Date.now().toString(36), name: "New trip", times: ["10:00"], durationH: 2, capacity: 10, priceAdult: 40, priceChild: 20, childAge: "3-11", keywords: "" }])}>Add trip</Button>}>
      {!props.trips.length && <Empty>No trips. The bot cannot quote or book without at least one.</Empty>}
      {props.trips.map((t, i) => (
        <div key={t.id} className="box stack">
          <div className="form-grid">
            <Field label="Name"><Input id={`tr-n-${i}`} value={t.name} onChange={(v) => upd(i, { name: v })} /></Field>
            <Field label="Departure times" hint="e.g. 10:00, 14:00"><Input id={`tr-t-${i}`} value={t.times.join(", ")} onChange={(v) => upd(i, { times: v.split(",").map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).map((x) => x.padStart(5, "0")) })} /></Field>
            <Field label="Hours"><Input id={`tr-h-${i}`} type="number" min={0} step={0.5} value={t.durationH} onChange={(v) => upd(i, { durationH: Number(v) || 0 })} /></Field>
            <Field label="Seats per departure"><Input id={`tr-c-${i}`} type="number" min={1} value={t.capacity} onChange={(v) => upd(i, { capacity: Number(v) || 0 })} /></Field>
            <Field label="Adult price (€)"><Input id={`tr-a-${i}`} type="number" min={0} value={t.priceAdult} onChange={(v) => upd(i, { priceAdult: Number(v) || 0 })} /></Field>
            <Field label="Child price (€)"><Input id={`tr-k-${i}`} type="number" min={0} value={t.priceChild} onChange={(v) => upd(i, { priceChild: Number(v) || 0 })} /></Field>
            <Field label="Child ages"><Input id={`tr-g-${i}`} value={t.childAge} onChange={(v) => upd(i, { childAge: v })} /></Field>
            <Field label="Words guests use" wide hint="Any language, comma separated. Helps match the trip."><Input id={`tr-w-${i}`} value={t.keywords} onChange={(v) => upd(i, { keywords: v })} /></Field>
          </div>
          <div className="row"><ConfirmButton label="Remove trip" confirm="Remove" onConfirm={() => props.onChange(props.trips.filter((_, j) => j !== i))} /></div>
        </div>
      ))}
    </Card>
  );
}

function ZonesEditor(props: { zones: Zone[]; onChange: (z: Zone[]) => void }) {
  const upd = (i: number, patch: Partial<Zone>) => props.onChange(props.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  return (
    <Card title="Hotel pickup zones" aside={<Button small onClick={() => props.onChange([...props.zones, { name: "", fee: 0, note: "" }])}>Add zone</Button>}>
      {!props.zones.length && <p className="small muted">No pickup. Guests are sent to the meeting point.</p>}
      {props.zones.map((z, i) => (
        <div key={i} className="form-grid">
          <Field label="Town or area"><Input id={`z-n-${i}`} value={z.name} onChange={(v) => upd(i, { name: v })} placeholder="Costa Adeje" /></Field>
          <Field label="Fee per booking (€)"><Input id={`z-f-${i}`} type="number" min={0} value={z.fee} onChange={(v) => upd(i, { fee: Number(v) || 0 })} /></Field>
          <Field label="Note"><Input id={`z-o-${i}`} value={z.note} onChange={(v) => upd(i, { note: v })} placeholder="45 min before departure" /></Field>
          <Button small kind="ghost" onClick={() => props.onChange(props.zones.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
    </Card>
  );
}

function MTextEditor(props: { id: string; label: string; value: MText; langs: Lang[]; onChange: (v: MText) => void }) {
  return (
    <div className="stack-sm">
      <Field label={`${props.label} (EN)`}><TextArea id={props.id} rows={2} value={props.value.en} onChange={(v) => props.onChange({ ...props.value, en: v })} /></Field>
      {props.langs.map((l) => (
        <Field key={l} label={`${props.label} (${l.toUpperCase()})`}>
          <Input id={`${props.id}-${l}`} value={props.value[l] ?? ""} onChange={(v) => props.onChange({ ...props.value, [l]: v || undefined })} placeholder="Optional translation" />
        </Field>
      ))}
    </div>
  );
}

function FaqEditor(props: { faq: Faq[]; langs: Lang[]; onChange: (f: Faq[]) => void }) {
  const upd = (i: number, patch: Partial<Faq>) => props.onChange(props.faq.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <Card title="FAQ (approved answers)" aside={<Button small onClick={() => props.onChange([...props.faq, { id: "f" + Date.now().toString(36), q: "", keys: "", a: { en: "" } }])}>Add question</Button>}>
      {!props.faq.length && <Empty>No FAQ yet. Questions the bot cannot match go to the owner.</Empty>}
      {props.faq.map((f, i) => (
        <div key={f.id} className="box stack-sm">
          <div className="form-grid">
            <Field label="Question"><Input id={`fq-${i}`} value={f.q} onChange={(v) => upd(i, { q: v })} /></Field>
            <Field label="Trigger words (any language)"><Input id={`fk-${i}`} value={f.keys} onChange={(v) => upd(i, { keys: v })} placeholder="parking, aparcar, parken" /></Field>
          </div>
          <MTextEditor id={`fa-${i}`} label="Answer" value={f.a} langs={props.langs} onChange={(a) => upd(i, { a })} />
          <div className="row"><ConfirmButton label="Remove" confirm="Remove question" onConfirm={() => props.onChange(props.faq.filter((_, j) => j !== i))} /></div>
        </div>
      ))}
    </Card>
  );
}

/* ---------- Seed ---------- */

const ts = (days: number, hh: number, mm = 0) => {
  const d = new Date(Date.now() + days * 864e5);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};
const at = (iso: string, addMin: number) => new Date(new Date(iso).getTime() + addMin * 6e4).toISOString();

interface SeedChat { id: string; clientId: string; guest: string; phone: string; lang: Lang; channel: ChannelId; start: string; status: Chat["status"]; lines: [Msg["from"], string][]; bookingId?: string }

export async function seed(): Promise<void> {
  await put(COL.bots, example("ex-receptionist-bot-whale", WHALE_BOT));
  await put(COL.bots, example("ex-receptionist-bot-dive", DIVE_BOT));

  const W = EX.whale;
  const bk = (id: string, created: string, b: Omit<Booking, "id" | "createdAt" | "example" | "paymentLink" | "reminders" | "clientId"> & { clientId?: string }) => {
    const rec: Booking = {
      ...example(id, { clientId: W, ...b, paymentLink: `https://pay.example/isla/${b.code}`, reminders: [] as Booking["reminders"] }),
      createdAt: created,
    };
    const start = new Date(`${b.date}T${b.time}:00`).getTime();
    rec.reminders = b.status === "cancelled" || b.status === "weather-cancelled"
      ? [{ kind: "reminder", at: new Date(start - 864e5).toISOString(), status: "cancelled" }]
      : [24, 2].map((h) => ({ kind: "reminder" as const, at: new Date(start - h * 36e5).toISOString(), status: start - h * 36e5 < Date.now() ? "sent" as const : "scheduled" as const }));
    return put(COL.bookings, rec);
  };
  const t1 = ts(-6, 21, 14), t2 = ts(-5, 7, 40), t3 = ts(-4, 13, 5), t4 = ts(-3, 22, 30), t5 = ts(-2, 11, 12), t6 = ts(-1, 20, 3), t7 = ts(0, 8, 20);
  await bk("ex-receptionist-bk-1", t1, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(-4), time: "10:00", adults: 2, children: 2, guestName: "Sophie Wagner", guestPhone: "+49 151 2233 4455", lang: "de", hotel: "Hotel Gala", zone: "Playa de las Américas", total: 140, status: "paid", code: "AWT-K2F8", channel: "whatsapp", chatId: "ex-receptionist-chat-1" });
  await bk("ex-receptionist-bk-2", t2, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(-3), time: "14:00", adults: 4, children: 0, guestName: "Giulia Romano", guestPhone: "+39 347 555 1290", lang: "it", zone: "Los Gigantes", total: 190, status: "paid", code: "AWT-L9Q1", channel: "instagram", chatId: "ex-receptionist-chat-2" });
  await bk("ex-receptionist-bk-3", t3, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(1), time: "10:00", adults: 2, children: 1, guestName: "Tom Hughes", guestPhone: "+44 7700 900 412", lang: "en", hotel: "Hotel Bahía Princess", zone: "Costa Adeje", total: 120, status: "paid", code: "AWT-M3D6", channel: "whatsapp", chatId: "ex-receptionist-chat-3" });
  await bk("ex-receptionist-bk-4", t4, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(1), time: "10:00", adults: 6, children: 3, guestName: "Familie Berger", guestPhone: "+43 664 120 3344", lang: "de", total: 345, status: "paid", code: "AWT-N7P2", channel: "web" });
  await bk("ex-receptionist-bk-5", t5, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(2), time: "14:00", adults: 3, children: 0, guestName: "Lucía Ortega", guestPhone: "+34 611 482 907", lang: "es", hotel: "Hotel Jardín Tropical", zone: "Costa Adeje", total: 140, status: "awaiting payment", code: "AWT-P4R8", channel: "whatsapp", chatId: "ex-receptionist-chat-4" });
  await bk("ex-receptionist-bk-6", t6, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(3), time: "14:00", adults: 2, children: 0, guestName: "Marco Bianchi", guestPhone: "+39 333 210 7788", lang: "it", zone: "Los Cristianos", total: 90, status: "weather-cancelled", code: "AWT-Q8S3", channel: "whatsapp" });
  await bk("ex-receptionist-bk-7", t6, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(1), time: "14:00", adults: 18, children: 2, guestName: "Jet2 group via rep", guestPhone: "+44 7700 900 870", lang: "en", total: 860, status: "paid", code: "AWT-R2T5", channel: "google" });
  await bk("ex-receptionist-bk-8", t7, { tripId: "whale", tripName: "Whale & dolphin trip", date: dayOffset(5), time: "10:00", adults: 2, children: 0, guestName: "Emma Lindqvist", guestPhone: "+46 70 123 4567", lang: "en", zone: "Costa Adeje", total: 95, status: "awaiting payment", code: "AWT-S6V9", channel: "whatsapp" });
  await bk("ex-receptionist-bk-9", t1, { clientId: EX.dive, tripId: "dsd", tripName: "Discover Scuba", date: dayOffset(2), time: "09:30", adults: 2, children: 0, guestName: "Daan de Vries", guestPhone: "+31 6 1234 5678", lang: "nl", total: 170, status: "paid", code: "APD-T1W4", channel: "whatsapp" });

  await put(COL.blocks, example("ex-receptionist-block-1", { clientId: W, tripId: "whale", date: dayOffset(3), time: "14:00", reason: "AEMET yellow wind warning, harbour master closed afternoon trips" }));

  const chats: SeedChat[] = [
    { id: "ex-receptionist-chat-1", clientId: W, guest: "Sophie Wagner", phone: "+49 151 2233 4455", lang: "de", channel: "whatsapp", start: t1, status: "booked", bookingId: "ex-receptionist-bk-1", lines: [
      ["guest", "Hallo! Wir sind 2 Erwachsene und 2 Kinder (7 und 10). Habt ihr noch Plätze für die Walbeobachtung?"],
      ["bot", "Hallo! Hier ist der Buchungsassistent von Atlántico Whale Trips. An welchem Tag möchten Sie fahren?"],
      ["guest", `Am ${fmtDay(dayOffset(-4), "de")} um 10 Uhr, wir wohnen im Hotel Gala in Las Américas`],
      ["bot", `Ihre Buchung:\nWhale & dolphin trip, ${fmtDay(dayOffset(-4), "de")} um 10:00\n2 Erwachsene, 2 Kinder\nAbholung: Hotel Gala, Playa de las Américas (free)\nGesamt: 140 €\n\nAntworten Sie mit JA, dann schicke ich den Zahlungslink.`],
      ["guest", "Ja bitte"],
      ["bot", "Gebucht. Ihre Buchungsnummer ist AWT-K2F8.\nHier bezahlen, um die Plätze zu sichern: https://pay.example/isla/AWT-K2F8\nIch schicke Ihnen 2 Erinnerungen vor der Tour."],
    ] },
    { id: "ex-receptionist-chat-2", clientId: W, guest: "Giulia Romano", phone: "+39 347 555 1290", lang: "it", channel: "instagram", start: t2, status: "booked", bookingId: "ex-receptionist-bk-2", lines: [
      ["guest", "Ciao! Quanto costa l'escursione per vedere le balene? Siamo in 4"],
      ["bot", "I nostri prezzi:\nWhale & dolphin trip: adulti 45 €, bambini (3-11) 25 €\nPrelievo: Costa Adeje (5 €), Los Gigantes (10 €)\n\nPer quale giorno volete prenotare?"],
      ["guest", `${fmtDay(dayOffset(-3), "it")} pomeriggio, albergo a Los Gigantes`],
      ["bot", `Ecco la vostra prenotazione:\nWhale & dolphin trip, ${fmtDay(dayOffset(-3), "it")} alle 14:00\n4 adulti\nPrelievo: Los Gigantes\nTotale: 190 €\n\nRispondete SÌ per confermare e vi mando il link di pagamento.`],
      ["guest", "Sì, perfetto!"],
      ["bot", "Prenotato. Il vostro codice è AWT-L9Q1.\nPagate qui per bloccare i posti: https://pay.example/isla/AWT-L9Q1\nVi manderò 2 promemoria prima dell'escursione."],
    ] },
    { id: "ex-receptionist-chat-3", clientId: W, guest: "Tom Hughes", phone: "+44 7700 900 412", lang: "en", channel: "whatsapp", start: t3, status: "booked", bookingId: "ex-receptionist-bk-3", lines: [
      ["guest", "Hi, will we definitely see dolphins? Thinking of booking for 2 adults and our son (6)"],
      ["bot", "We see pilot whales or dolphins on over 95% of trips. If we see none, your next trip is free.\n\nWhich date would you like to go?"],
      ["guest", `${fmtDay(dayOffset(1), "en")} morning please, Hotel Bahía Princess in Costa Adeje`],
      ["bot", `Here is your booking:\nWhale & dolphin trip, ${fmtDay(dayOffset(1), "en")} at 10:00\n2 adults, 1 child\nPickup: Hotel Bahía Princess, Costa Adeje\nTotal: €120\n\nReply YES to confirm and I will send the payment link.`],
      ["guest", "Yes!"],
      ["bot", "Booked. Your reference is AWT-M3D6.\nPay here to secure your seats: https://pay.example/isla/AWT-M3D6\nI will send you 2 reminders before the trip."],
    ] },
    { id: "ex-receptionist-chat-4", clientId: W, guest: "Lucía Ortega", phone: "+34 611 482 907", lang: "es", channel: "whatsapp", start: t5, status: "booked", bookingId: "ex-receptionist-bk-5", lines: [
      ["guest", "Hola, somos 3 adultos, ¿hay plazas pasado mañana por la tarde?"],
      ["bot", "¿Necesitáis recogida en el hotel? Recogemos en Los Cristianos (gratis), Playa de las Américas (gratis), Costa Adeje (5 €), Los Gigantes (10 €). O nos vemos en Los Cristianos harbour, pier 2, 30 min before departure."],
      ["guest", "Hotel Jardín Tropical, Costa Adeje"],
      ["bot", `Esta es vuestra reserva:\nWhale & dolphin trip, ${fmtDay(dayOffset(2), "es")} a las 14:00\n3 adultos\nRecogida: Hotel Jardín Tropical, Costa Adeje\nTotal: 140 €\n\nResponded SÍ para confirmar y os envío el enlace de pago.`],
      ["guest", "Sí"],
      ["bot", "Reservado. Vuestra referencia es AWT-P4R8.\nPagad aquí para asegurar las plazas: https://pay.example/isla/AWT-P4R8\nOs enviaré 2 recordatorios antes de la excursión."],
    ] },
    { id: "ex-receptionist-chat-5", clientId: W, guest: "Klaus Neumann", phone: "+49 160 998 1122", lang: "de", channel: "whatsapp", start: t4, status: "handoff", lines: [
      ["guest", "Guten Abend, mein Vater sitzt im Rollstuhl. Kann er mit auf das Boot?"],
      ["bot", "Gute Frage. Ich gebe das an das Team weiter, damit Sie die richtige Antwort bekommen. Sie melden sich hier in Kürze (9:00-19:00), oder rufen Sie +34 622 000 102 an."],
      ["note", "Handed off to +34 622 000 102 with a summary. Task created on Today."],
    ] },
    { id: "ex-receptionist-chat-6", clientId: W, guest: "Francesca Leone", phone: "+39 340 778 2210", lang: "it", channel: "whatsapp", start: t6, status: "handoff", lines: [
      ["guest", "Buonasera, siamo un gruppo di 14 amici, c'è uno sconto di gruppo per sabato?"],
      ["bot", "Bella domanda. La passo al team così avrete la risposta giusta. Vi rispondono qui a breve (9:00-19:00), oppure chiamate +34 622 000 102."],
      ["note", "Handed off to +34 622 000 102 with a summary. Task created on Today."],
    ] },
    { id: "ex-receptionist-chat-7", clientId: W, guest: "Emma Lindqvist", phone: "+46 70 123 4567", lang: "en", channel: "whatsapp", start: t7, status: "open", lines: [
      ["guest", "Hello, is the boat ok if I get seasick easily?"],
      ["bot", "The catamaran is very stable. If you get seasick easily, take a tablet one hour before departure."],
      ["guest", "Thanks! What about parking at the harbour?"],
      ["bot", "Good question. I will pass this to the team so you get the right answer. They will reply here shortly (9:00-19:00), or call +34 622 000 102."],
      ["owner", "Hi Emma, there is a paid car park at Los Cristianos harbour, about €1.50 an hour. See you soon! Iván"],
    ] },
    { id: "ex-receptionist-chat-8", clientId: W, guest: "Pieter Jansen", phone: "+31 6 4455 6677", lang: "en", channel: "whatsapp", start: ts(-6, 9, 50), status: "closed", lines: [
      ["guest", "Hi, how long is the trip and when do you leave?"],
      ["bot", "Whale & dolphin trip leaves at 10:00 / 14:00 and lasts about 3 hours."],
    ] },
    { id: "ex-receptionist-chat-9", clientId: W, guest: "Hannah Schulz", phone: "+49 172 600 4411", lang: "de", channel: "instagram", start: ts(-5, 19, 45), status: "closed", lines: [
      ["guest", "Was kostet die Tour für Kinder?"],
      ["bot", "Unsere Preise:\nWhale & dolphin trip: Erwachsene 45 €, Kinder (3-11) 25 €\nAbholung: Costa Adeje (5 €), Los Gigantes (10 €)"],
    ] },
    { id: "ex-receptionist-chat-10", clientId: W, guest: "Chiara Fontana", phone: "+39 349 112 9087", lang: "it", channel: "whatsapp", start: ts(-4, 23, 10), status: "closed", lines: [
      ["guest", "Cosa è incluso? E se c'è vento?"],
      ["bot", "Bibite, uno snack e una sosta per il bagno con maschera e boccaglio sono inclusi.\n\nRegola meteo: Decide la capitaneria il giorno stesso. Se annulliamo per vento o mare mosso, scegliete una nuova data o il rimborso completo."],
    ] },
    { id: "ex-receptionist-chat-11", clientId: W, guest: "James O'Neill", phone: "+353 87 123 9900", lang: "en", channel: "web", start: ts(-3, 15, 30), status: "closed", lines: [
      ["guest", "What's the cancellation policy?"],
      ["bot", "Cancellation policy: Free cancellation up to 24 hours before departure. Later cancellations are not refunded."],
    ] },
    { id: "ex-receptionist-chat-12", clientId: W, guest: "Carmen Ruiz", phone: "+34 655 230 118", lang: "es", channel: "whatsapp", start: ts(-2, 6, 55), status: "closed", lines: [
      ["guest", "¿Qué hay que llevar? ¿Se ven ballenas seguro?"],
      ["bot", "Vemos calderones o delfines en más del 95 % de las salidas. Si no vemos ninguno, la próxima salida es gratis.\n\nTraed crema solar, gorra, toalla y bañador."],
    ] },
  ];
  for (const c of chats) {
    let t = c.start;
    const messages: Msg[] = c.lines.map(([from, text], i) => { t = at(t, i === 0 ? 0 : from === "bot" || from === "note" ? 0.1 : from === "owner" ? 38 : 3); return { from, text, at: t }; });
    const rec: Chat = { ...example(c.id, { clientId: c.clientId, channel: c.channel, guestName: c.guest, guestPhone: c.phone, lang: c.lang, messages, state: {}, status: c.status, bookingId: c.bookingId, firstResponseSec: 4 + (c.id.length % 5), live: false }), createdAt: c.start };
    await put(COL.chats, rec);
  }

  const tasks: Task[] = [
    { ...example("ex-receptionist-task-1", { title: "Reply to Klaus Neumann (DE) for Atlántico Whale Trips: wheelchair access question", module: "receptionist", clientId: W, due: dayOffset(0), done: false }) },
    { ...example("ex-receptionist-task-2", { title: "Reply to Francesca Leone (IT) for Atlántico Whale Trips: group discount for 14", module: "receptionist", clientId: W, due: dayOffset(0), done: false }) },
  ];
  for (const t of tasks) await put("tasks", t);
  const hs: Handoff[] = [
    { ...example("ex-receptionist-ho-1", { clientId: W, chatId: "ex-receptionist-chat-5", guestName: "Klaus Neumann", guestPhone: "+49 160 998 1122", lang: "de" as Lang, reason: "Accessibility question (wheelchair).", summary: "Klaus (German) asks if his father, a wheelchair user, can join the whale trip. No date or group size yet. Needs a personal answer about boarding at pier 2 and the deck. Reply in German.", status: "open" as const, taskId: "ex-receptionist-task-1", live: false }), createdAt: t4 },
    { ...example("ex-receptionist-ho-2", { clientId: W, chatId: "ex-receptionist-chat-6", guestName: "Francesca Leone", guestPhone: "+39 340 778 2210", lang: "it" as Lang, reason: "Group discount for 14 people.", summary: "Francesca (Italian) has a group of 14 friends for Saturday and asks for a group discount. Saturday 10:00 has seats. No discount is in the approved data, so the owner decides. Reply in Italian.", status: "open" as const, taskId: "ex-receptionist-task-2", live: false }), createdAt: t6 },
    { ...example("ex-receptionist-ho-3", { clientId: W, chatId: "ex-receptionist-chat-7", guestName: "Emma Lindqvist", guestPhone: "+46 70 123 4567", lang: "en" as Lang, reason: "Parking question not in FAQ.", summary: "Emma (English, Swedish number) asked about parking at the harbour. Not in the FAQ. Iván replied; consider adding parking to the FAQ.", status: "resolved" as const, live: false, resolvedAt: at(t7, 40) }), createdAt: t7 },
  ];
  for (const h of hs) await put(COL.handoffs, h);

  const audit: Audit = example("ex-receptionist-audit-1", {
    business: "Teno Kayak & Snorkel", town: "Los Gigantes", contact: "Pablo Gorrín", phone: "+34 622 000 311", requested: true,
    days: [
      { day: "Mon", enquiries: 14, unanswered: 3, avgMin: 85 }, { day: "Tue", enquiries: 11, unanswered: 2, avgMin: 120 },
      { day: "Wed", enquiries: 16, unanswered: 5, avgMin: 140 }, { day: "Thu", enquiries: 12, unanswered: 2, avgMin: 70 },
      { day: "Fri", enquiries: 18, unanswered: 6, avgMin: 160 }, { day: "Sat", enquiries: 22, unanswered: 8, avgMin: 210 },
      { day: "Sun", enquiries: 19, unanswered: 7, avgMin: 190 },
    ],
    bookingValue: 110, convFast: 35,
  });
  await put(COL.audits, audit);
}
