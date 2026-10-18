// Receptionist sub-screens: bookings, availability, handoff inbox, channels, weekly report, audit.
import { useMemo, useState } from "react";
import {
  Card, Button, Field, Input, TextArea, Select, Badge, Empty, Table, Stats, Stat, AiOutput, CopyButton, ConfirmButton, LangTag, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, put, remove, create, today, now } from "../core/store";
import { aiText, pick } from "../core/ai";
import { LANGS, eur } from "../core/plans";
import type { Client, Task } from "../core/types";
import {
  type Bot, type Booking, type Block, type Chat, type Handoff, type ChannelId, type BookingStatus,
  slotInfo, addDays, fmtDay, norm,
} from "./receptionist-engine";
import { COL, CHANNEL_LABEL, channelAllowed, tierOf, closeTask, hhmm, type Audit, type WeekReport } from "./receptionist-shared";

const STATUS_TONE: Record<BookingStatus, Tone> = { "awaiting payment": "warn", paid: "good", cancelled: "neutral", "weather-cancelled": "bad" };
const seats = (b: Booking) => b.adults + b.children;
const isLive = (b: Booking) => b.status === "paid" || b.status === "awaiting payment";

/* ---------- Bookings ---------- */

type BFilter = "upcoming" | "awaiting" | "past" | "cancelled" | "all";

export function BookingsView(props: { bot: Bot; client: Client; bookings: Booking[] }) {
  const [filter, setFilter] = useState<BFilter>("upcoming");
  const t = today();
  const rows = props.bookings
    .filter((b) =>
      filter === "all" ? true
        : filter === "upcoming" ? b.date >= t && isLive(b)
          : filter === "awaiting" ? b.status === "awaiting payment"
            : filter === "past" ? b.date < t && isLive(b)
              : !isLive(b))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const week = props.bookings.filter((b) => isLive(b) && b.date >= t && b.date <= addDays(t, 7));
  const awaiting = props.bookings.filter((b) => b.status === "awaiting payment");

  async function setStatus(b: Booking, status: BookingStatus) {
    const reminders = status === "paid" ? b.reminders : b.reminders.map((r) => (r.status === "scheduled" ? { ...r, status: "cancelled" as const } : r));
    await put(COL.bookings, { ...b, status, reminders });
    toast(status === "paid" ? `${b.code} marked paid.` : `${b.code} cancelled and reminders stopped. Tell the guest yourself (WhatsApp not connected yet).`);
  }

  return (
    <div className="stack">
      <Stats>
        <Stat label="Upcoming bookings" value={props.bookings.filter((b) => b.date >= t && isLive(b)).length} />
        <Stat label="Seats next 7 days" value={week.reduce((s, b) => s + seats(b), 0)} />
        <Stat label="Awaiting payment" value={eur(awaiting.reduce((s, b) => s + b.total, 0))} sub={`${awaiting.length} links open`} tone={awaiting.length ? "warn" : undefined} />
        <Stat label="Booked by the bot, next 7 days" value={eur(week.reduce((s, b) => s + b.total, 0))} tone="good" />
      </Stats>
      <Card title="Bookings" aside={
        <Select<BFilter> id="bk-filter" value={filter} onChange={setFilter} options={[
          { value: "upcoming", label: "Upcoming" }, { value: "awaiting", label: "Awaiting payment" }, { value: "past", label: "Past" },
          { value: "cancelled", label: "Cancelled" }, { value: "all", label: "All" },
        ]} />
      }>
        <Table<Booking>
          rows={rows}
          rowKey={(b) => b.id}
          empty="No bookings in this view. Bookings appear here when a guest confirms in the chat."
          cols={[
            { label: "When", render: (b) => <span className="stack-sm"><strong>{fmtDate(b.date)}</strong><span className="small muted">{b.time} · {b.tripName}</span></span> },
            { label: "Guest", render: (b) => <span className="stack-sm"><span className="row">{b.guestName}<LangTag lang={b.lang} /></span><span className="small faint">{CHANNEL_LABEL[b.channel]} · {b.code}</span></span> },
            { label: "Seats", num: true, render: (b) => `${b.adults}+${b.children}` },
            { label: "Pickup", render: (b) => (b.zone ? <span className="small">{b.hotel ? `${b.hotel}, ` : ""}{b.zone}</span> : <span className="small faint">Meets at harbour</span>) },
            { label: "Total", num: true, render: (b) => eur(b.total) },
            { label: "Status", render: (b) => <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge> },
            { label: "Reminders", render: (b) => <ReminderCell b={b} /> },
            { label: "", render: (b) => (
              <span className="row wrap">
                {b.status === "awaiting payment" && <Button small onClick={() => setStatus(b, "paid")}>Mark paid</Button>}
                {b.status === "awaiting payment" && <CopyButton text={b.paymentLink} label="Copy link" />}
                {isLive(b) && <ConfirmButton label="Cancel" confirm="Cancel booking" onConfirm={() => setStatus(b, "cancelled")} />}
              </span>
            ) },
          ]}
        />
        <p className="small faint">Payment links are placeholders until Stripe is connected. Reminders are queued as WhatsApp utility templates and marked, not sent.</p>
      </Card>
    </div>
  );
}

function ReminderCell(props: { b: Booking }) {
  const r = props.b.reminders;
  if (!r.length) return <span className="small faint">None</span>;
  const n = (s: string) => r.filter((x) => x.status === s).length;
  const next = r.filter((x) => x.status === "scheduled").sort((a, b) => a.at.localeCompare(b.at))[0];
  return (
    <span className="stack-sm small">
      <span>{n("scheduled")} queued{n("sent") ? ` · ${n("sent")} sent` : ""}{n("cancelled") ? ` · ${n("cancelled")} stopped` : ""}</span>
      {next && <span className="faint">next {fmtDate(next.at)} {hhmm(next.at)}{next.kind === "review" ? " (review)" : ""}</span>}
    </span>
  );
}

/* ---------- Availability calendar ---------- */

interface SlotKey { tripId: string; date: string; time: string }

export function CalendarView(props: { bot: Bot; client: Client; bookings: Booking[]; blocks: Block[] }) {
  const { bot, client, bookings, blocks } = props;
  const [days, setDays] = useState(14);
  const [sel, setSel] = useState<SlotKey | null>(null);
  const [reason, setReason] = useState("Wind warning, harbour master closed the trip");
  const dates = Array.from({ length: days }, (_, i) => addDays(today(), i));

  const selTrip = sel && bot.trips.find((t) => t.id === sel.tripId);
  const selInfo = sel ? slotInfo(bot, bookings, blocks, sel.tripId, sel.date, sel.time) : undefined;
  const selBookings = sel ? bookings.filter((b) => b.clientId === client.id && b.tripId === sel.tripId && b.date === sel.date && b.time === sel.time) : [];

  async function cancelForWeather() {
    if (!sel) return;
    await create<Block>(COL.blocks, { clientId: client.id, ...sel, reason });
    const hit = selBookings.filter(isLive);
    for (const b of hit) {
      await put(COL.bookings, { ...b, status: "weather-cancelled", reminders: b.reminders.map((r) => (r.status === "scheduled" ? { ...r, status: "cancelled" as const } : r)) });
    }
    if (hit.length) {
      await create<Task>("tasks", {
        title: `Contact ${hit.length} guest${hit.length > 1 ? "s" : ""} of ${client.name} about the weather cancellation on ${fmtDate(sel.date)} ${sel.time}: offer a new date or refund`,
        module: "receptionist", clientId: client.id, due: today(), done: false,
      });
    }
    toast(hit.length ? `Departure closed. ${hit.length} booking${hit.length > 1 ? "s" : ""} marked weather-cancelled and a follow-up task was added (WhatsApp not connected yet).` : "Departure closed. The bot will not offer it.");
  }
  async function reopen() {
    if (!selInfo?.block) return;
    await remove(COL.blocks, selInfo.block.id);
    toast("Departure reopened. Weather-cancelled bookings stay cancelled.");
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted small">Seats left per departure. The assistant checks this before it offers a time, so it never double books.</p>
        <Select id="cal-days" value={String(days)} onChange={(v) => setDays(Number(v))} options={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "21", label: "21 days" }]} />
      </div>
      <div className="split">
        <div className="stack">
          {sel && selTrip && selInfo ? (
            <Card title={`${selTrip.name}, ${fmtDay(sel.date, "en")} ${sel.time}`} aside={<Button small kind="ghost" onClick={() => setSel(null)}>Close</Button>}>
              <Stats>
                <Stat label="Seats left" value={selInfo.left} sub={`of ${selInfo.cap}`} tone={selInfo.block ? "bad" : selInfo.left < 5 ? "warn" : "good"} />
                <Stat label="Booked" value={selInfo.booked} />
              </Stats>
              {selInfo.block && <div className="banner small"><span><strong>Closed:</strong> {selInfo.block.reason}</span></div>}
              <div className="stack-sm">
                {selBookings.length ? selBookings.map((b) => (
                  <div key={b.id} className="row between small box">
                    <span className="row">{b.guestName}<LangTag lang={b.lang} /></span>
                    <span className="row">{b.adults}+{b.children}<Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge></span>
                  </div>
                )) : <p className="small muted">No bookings on this departure.</p>}
              </div>
              {selInfo.block ? (
                <Button onClick={reopen}>Reopen departure</Button>
              ) : (
                <div className="stack-sm">
                  <Field label="Reason" hint={`Rule the guests get: ${bot.weatherRule.en || "add a weather rule in Bot setup"}`}>
                    <Input id="cal-reason" value={reason} onChange={setReason} />
                  </Field>
                  <ConfirmButton kind="secondary" label="Cancel for weather" confirm="Close departure" onConfirm={cancelForWeather} />
                </div>
              )}
            </Card>
          ) : (
            <Card title="Pick a departure">
              <p className="small muted">Select a cell to see the guests, close it for weather or reopen it.</p>
            </Card>
          )}
        </div>
        <div className="stack">
          {bot.trips.map((trip) => (
            <Card key={trip.id} title={trip.name} aside={<span className="small faint">{trip.capacity} seats · {trip.durationH} h</span>}>
              <Table<string>
                rows={dates}
                rowKey={(d) => d}
                cols={[
                  { label: "Date", render: (d) => <span className="small">{fmtDay(d, "en")}</span> },
                  ...trip.times.map((time) => ({
                    label: time,
                    render: (d: string) => {
                      const s = slotInfo(bot, bookings, blocks, trip.id, d, time);
                      const on = sel?.tripId === trip.id && sel.date === d && sel.time === time;
                      const pct = s.cap ? Math.round(((s.cap - s.left) / s.cap) * 100) : 100;
                      return (
                        <button type="button" className={"chip" + (on ? " chip-on" : "")} style={{ width: "100%", minWidth: 96, borderRadius: "var(--radius-md)" }} onClick={() => setSel({ tripId: trip.id, date: d, time })}
                          aria-label={`${d} ${time}: ${s.block ? "closed" : `${s.left} seats left`}`}>
                          <span className="stack-sm">
                            <span>{s.block ? "Closed" : s.left === 0 ? "Full" : `${s.left} left`}</span>
                            <span className="bar"><span style={{ width: `${pct}%`, background: s.block ? "var(--bad)" : s.left < 5 ? "var(--warn)" : undefined }} /></span>
                          </span>
                        </button>
                      );
                    },
                  })),
                ]}
              />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Handoff inbox ---------- */

export function HandoffsView(props: { bot: Bot; client: Client; handoffs: Handoff[]; chats: Chat[] }) {
  const { bot, client } = props;
  const tasks = useCollection<Task>("tasks");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const open = props.handoffs.filter((h) => h.status === "open");
  const done = props.handoffs.filter((h) => h.status === "resolved");

  async function reply(h: Handoff) {
    const text = (drafts[h.id] ?? "").trim();
    const chat = props.chats.find((c) => c.id === h.chatId);
    if (!text || !chat) return;
    await put(COL.chats, { ...chat, messages: [...chat.messages, { from: "owner", text, at: now() }] });
    toast("Reply added to the chat. WhatsApp not connected yet, so nothing was sent.");
  }
  async function saveFaq(h: Handoff) {
    const chat = props.chats.find((c) => c.id === h.chatId);
    const q = [...(chat?.messages ?? [])].reverse().find((m) => m.from === "guest")?.text ?? h.reason;
    const a = (drafts[h.id] ?? [...(chat?.messages ?? [])].reverse().find((m) => m.from === "owner")?.text ?? "").trim();
    if (!a) { toast("Write the answer first."); return; }
    const keys = [...new Set(norm(q).split(/[^a-z]+/).filter((w) => w.length > 5))].slice(0, 4).join(", ");
    await put(COL.bots, { ...bot, faq: [...bot.faq, { id: "f" + Date.now().toString(36), q, keys, a: { en: a } }] });
    toast("Added to the FAQ. Check the trigger words and translations in Bot setup.");
  }
  async function resolve(h: Handoff) {
    await put(COL.handoffs, { ...h, status: "resolved", resolvedAt: now() });
    await closeTask(h.taskId, tasks);
    const chat = props.chats.find((c) => c.id === h.chatId);
    if (chat && chat.status === "handoff") await put(COL.chats, { ...chat, status: "open" });
    toast("Resolved. The task on Today is done.");
  }

  if (!props.handoffs.length) return <Empty>No handoffs. When the assistant is unsure, it passes the chat here with a summary and adds a task to Today.</Empty>;
  return (
    <div className="stack">
      <p className="small muted">Tricky chats go to {bot.handoffPhone || "the owner"} with a summary. Reply inside the 24-hour window so the message is free.</p>
      {!open.length && <Empty>All handoffs are resolved.</Empty>}
      {open.map((h) => {
        const chat = props.chats.find((c) => c.id === h.chatId);
        return (
          <Card key={h.id} title={<span className="row wrap">{h.guestName}<LangTag lang={h.lang} /><Badge tone="warn">{h.reason}</Badge></span>} aside={<span className="small faint">{fmtDate(h.createdAt)} {hhmm(h.createdAt)}</span>}>
            <AiOutput title="Summary for the owner" text={h.summary} live={h.live} />
            {chat && (
              <div className="chat" style={{ minHeight: 0, maxHeight: 240 }}>
                {chat.messages.filter((m) => m.from !== "note").slice(-4).map((m, i) => (
                  <div key={i} className={"bubble " + (m.from === "guest" ? "bubble-in" : "bubble-out")}>{m.text}<div className="bubble-meta">{m.from === "guest" ? "Guest" : m.from === "owner" ? "Owner" : "Assistant"} · {hhmm(m.at)}</div></div>
                ))}
              </div>
            )}
            <Field label={`Your reply (write in ${LANGS[h.lang] ?? h.lang})`}>
              <TextArea id={`ho-${h.id}`} rows={3} value={drafts[h.id] ?? ""} onChange={(v) => setDrafts({ ...drafts, [h.id]: v })} />
            </Field>
            <div className="row wrap">
              <Button kind="primary" onClick={() => reply(h)} disabled={!(drafts[h.id] ?? "").trim()}>Add reply to chat</Button>
              <Button onClick={() => saveFaq(h)}>Save answer to FAQ</Button>
              <Button kind="ghost" onClick={() => resolve(h)}>Mark resolved</Button>
              <span className="small faint">{client.contact} · {h.guestPhone}</span>
            </div>
          </Card>
        );
      })}
      {done.length > 0 && (
        <Card title="Resolved">
          <Table<Handoff> rows={done} rowKey={(h) => h.id} cols={[
            { label: "Guest", render: (h) => <span className="row">{h.guestName}<LangTag lang={h.lang} /></span> },
            { label: "Reason", render: (h) => <span className="small">{h.reason}</span> },
            { label: "Resolved", render: (h) => <span className="small">{fmtDate(h.resolvedAt)}</span> },
            { label: "", render: (h) => <ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove(COL.handoffs, h.id)} /> },
          ]} />
        </Card>
      )}
    </div>
  );
}

/* ---------- Channels ---------- */

const CH_TONE = { connected: "good", pending: "warn", off: "neutral" } as const;
const CH_NOTE: Record<ChannelId, string> = {
  whatsapp: "Meta WhatsApp Cloud API via n8n. Needs Meta Business verification and a dedicated number.",
  instagram: "Instagram Graph API for DMs on the business account.",
  web: "Booking form on the operator's site that opens the same assistant.",
  google: "Messages from the Google Business Profile.",
};

export function ChannelsView(props: { bot: Bot; client: Client; chats: Chat[] }) {
  const { bot, client } = props;
  const tier = tierOf(client);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const digits = client.phone.replace(/\D/g, "");
  async function setCh(ch: ChannelId, state: Bot["channels"][ChannelId]) {
    await put(COL.bots, { ...bot, channels: { ...bot.channels, [ch]: state } });
    toast(state === "off" ? `${CHANNEL_LABEL[ch]} switched off.` : `${CHANNEL_LABEL[ch]} marked ${state} (simulated, nothing is connected yet).`);
  }
  return (
    <div className="stack">
      <div className="banner small"><span><strong>Simulated:</strong> no channel is really connected yet. Status here tracks the setup work for each client.</span></div>
      <div className="grid-2">
        {(Object.keys(CHANNEL_LABEL) as ChannelId[]).map((ch) => {
          const st = bot.channels[ch];
          const allowed = channelAllowed(tier, ch);
          const n = props.chats.filter((c) => c.channel === ch && c.createdAt >= since).length;
          return (
            <Card key={ch} title={CHANNEL_LABEL[ch]} aside={<Badge tone={CH_TONE[st]}>{st === "connected" ? "Connected (simulated)" : st === "pending" ? "Pending review" : "Off"}</Badge>}>
              <p className="small muted">{CH_NOTE[ch]}</p>
              <p className="small">{n} enquiries in the last 7 days</p>
              <div className="row wrap">
                {!allowed ? <Badge tone="warn">Needs Pro plan</Badge>
                  : st === "off" ? <Button small onClick={() => setCh(ch, ch === "web" ? "connected" : "pending")}>Start connection</Button>
                    : st === "pending" ? <Button small onClick={() => setCh(ch, "connected")}>Mark approved</Button>
                      : <ConfirmButton label="Switch off" confirm="Switch off" onConfirm={() => setCh(ch, "off")} />}
              </div>
            </Card>
          );
        })}
      </div>
      <Card title="Links to share">
        <Field label="WhatsApp click-to-chat (for Google profile, flyers, Instagram bio)">
          <div className="row"><span className="mono box" style={{ flex: 1, overflowWrap: "anywhere" }}>{`https://wa.me/${digits}?text=${encodeURIComponent("Hola! I would like to book")}`}</span>
            <CopyButton text={`https://wa.me/${digits}?text=${encodeURIComponent("Hola! I would like to book")}`} /></div>
        </Field>
        <Field label="Web form embed (placeholder until the widget is hosted)">
          <div className="row"><span className="mono box" style={{ flex: 1, overflowWrap: "anywhere" }}>{`<iframe src="https://forms.example/isla/${bot.id}" title="${client.name} booking" width="100%" height="560"></iframe>`}</span>
            <CopyButton text={`<iframe src="https://forms.example/isla/${bot.id}" title="${client.name} booking" width="100%" height="560"></iframe>`} /></div>
        </Field>
        <p className="small faint">Meta policy: the assistant is limited to {client.name} support and bookings. Reminders outside the 24-hour window use approved utility templates, billed by Meta.</p>
      </Card>
    </div>
  );
}

/* ---------- Weekly report ---------- */

export function ReportView(props: { bot: Bot; client: Client; chats: Chat[]; bookings: Booking[]; handoffs: Handoff[] }) {
  const { bot, client } = props;
  const reports = useCollection<WeekReport>(COL.reports).filter((r) => r.clientId === client.id);
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<string>();
  const m = useMemo(() => weekMetrics(props.chats, props.bookings, props.handoffs), [props.chats, props.bookings, props.handoffs]);
  const latest = reports[0];

  async function write() {
    setBusy(true);
    setStream("");
    const facts = `Client: ${client.name} (${client.kind}, ${client.town}). Week ending ${today()}.
Enquiries: ${m.enquiries} (${m.afterHours} outside 9:00-19:00). Average first reply: ${m.avgSec} seconds; before the bot it was about ${bot.baselineResponseMin} minutes.
Bookings made by the assistant: ${m.bookings}, ${m.seats} seats, revenue captured ${eur(m.revenue)}. Conversion ${m.conv}%.
Handoffs to the owner: ${m.handoffs} (${m.openHandoffs} still open). Languages: ${m.langs.map(([l, n]) => `${l.toUpperCase()} ${n}`).join(", ")}. Channels: ${m.channels.map(([c, n]) => `${c} ${n}`).join(", ")}.`;
    const res = await aiText(
      `Write a short weekly WhatsApp-style report (max 120 words, plain text, no markdown) for the owner of ${client.name}, in English. Use only these facts, lead with bookings and revenue captured, compare the reply time with before, and end with one concrete suggestion (for example a FAQ to add from the handoffs). Do not promise results.\n\n${facts}`,
      () => demoReport(client, bot, m),
      { onText: setStream },
    );
    await create<WeekReport>(COL.reports, { clientId: client.id, weekEnd: today(), text: res.data, live: res.live });
    setStream(undefined);
    setBusy(false);
    if (res.error) toast(res.error);
  }

  const maxLang = Math.max(1, ...m.langs.map(([, n]) => n));
  return (
    <div className="stack">
      <Stats>
        <Stat label="Enquiries, 7 days" value={m.enquiries} sub={`${m.afterHours} after hours`} />
        <Stat label="First reply" value={m.enquiries ? `${m.avgSec} s` : "–"} sub={`Before the bot: ~${bot.baselineResponseMin} min`} tone="good" />
        <Stat label="Bookings" value={m.bookings} sub={`${m.conv}% of enquiries`} />
        <Stat label="Revenue captured" value={eur(m.revenue)} sub={`${m.seats} seats`} tone="accent" />
        <Stat label="Handoffs" value={m.handoffs} sub={`${m.openHandoffs} open`} tone={m.openHandoffs ? "warn" : undefined} />
      </Stats>
      <div className="grid-2">
        <Card title="Languages">
          {m.langs.length ? m.langs.map(([l, n]) => (
            <div key={l} className="stack-sm">
              <div className="row between small"><span className="row"><LangTag lang={l} />{LANGS[l as keyof typeof LANGS] ?? l}</span><span>{n}</span></div>
              <div className="bar"><span style={{ width: `${(n / maxLang) * 100}%` }} /></div>
            </div>
          )) : <p className="small muted">No enquiries this week.</p>}
        </Card>
        <Card title="Channels">
          {m.channels.length ? m.channels.map(([c, n]) => (
            <div key={c} className="row between small"><span>{c}</span><span>{n}</span></div>
          )) : <p className="small muted">No enquiries this week.</p>}
        </Card>
      </div>
      <Card title="Owner summary" aside={<Button kind="primary" busy={busy} onClick={write}>Write this week's summary</Button>}>
        {stream != null ? <AiOutput text={stream || "…"} live /> : latest ? (
          <AiOutput title={`Week ending ${fmtDate(latest.weekEnd)}`} text={latest.text} live={latest.live}
            actions={<ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove(COL.reports, latest.id)} />} />
        ) : <Empty>No summary yet. Write one and send it to {client.contact} on Monday.</Empty>}
        {reports.length > 1 && <p className="small faint">{reports.length - 1} earlier summaries saved.</p>}
      </Card>
    </div>
  );
}

interface Metrics { enquiries: number; afterHours: number; avgSec: number; bookings: number; seats: number; revenue: number; conv: number; handoffs: number; openHandoffs: number; langs: [string, number][]; channels: [string, number][] }

function weekMetrics(chats: Chat[], bookings: Booking[], handoffs: Handoff[]): Metrics {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const cs = chats.filter((c) => c.createdAt >= since);
  const bs = bookings.filter((b) => b.createdAt >= since && isLive(b));
  const hs = handoffs.filter((h) => h.createdAt >= since);
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const resp = cs.map((c) => c.firstResponseSec ?? 0).filter(Boolean);
  const enquiries = cs.length + bs.filter((b) => !b.chatId).length;
  return {
    enquiries,
    afterHours: cs.filter((c) => { const h = new Date(c.createdAt).getHours(); return h < 9 || h >= 19; }).length,
    avgSec: resp.length ? Math.round(resp.reduce((s, x) => s + x, 0) / resp.length) : 0,
    bookings: bs.length,
    seats: bs.reduce((s, b) => s + seats(b), 0),
    revenue: bs.reduce((s, b) => s + b.total, 0),
    conv: enquiries ? Math.round((bs.length / enquiries) * 100) : 0,
    handoffs: hs.length,
    openHandoffs: hs.filter((h) => h.status === "open").length,
    langs: count([...cs.map((c) => c.lang ?? "en"), ...bs.filter((b) => !b.chatId).map((b) => b.lang)]),
    channels: count([...cs.map((c) => CHANNEL_LABEL[c.channel]), ...bs.filter((b) => !b.chatId).map((b) => CHANNEL_LABEL[b.channel])]),
  };
}

function demoReport(client: Client, bot: Bot, m: Metrics) {
  const tip = pick([
    "Add parking at the harbour to the FAQ, it came up twice.",
    "Add a group-price rule so the bot can answer groups without a handoff.",
    "Translate the weather rule into Italian, it is the fastest-growing language.",
  ], client.id + m.enquiries);
  return `Weekly report for ${client.name}

${m.bookings} bookings this week, ${m.seats} seats, ${eur(m.revenue)} captured by the assistant.
${m.enquiries} enquiries, ${m.afterHours} of them outside office hours. First reply took ${m.avgSec || "a few"} seconds on average, against about ${bot.baselineResponseMin} minutes before.
Top languages: ${m.langs.slice(0, 3).map(([l, n]) => `${l.toUpperCase()} ${n}`).join(", ") || "none yet"}.
${m.handoffs} chats went to you${m.openHandoffs ? `, ${m.openHandoffs} still open` : ""}.

Suggestion: ${tip}`;
}

/* ---------- Missed enquiries audit (lead magnet) ---------- */

const factor = (min: number) => (min <= 5 ? 1 : min <= 30 ? 0.7 : min <= 120 ? 0.45 : min <= 360 ? 0.3 : 0.2);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function computeAudit(a: Audit) {
  const p0 = a.convFast / 100;
  const E = a.days.reduce((s, d) => s + d.enquiries, 0);
  const U = a.days.reduce((s, d) => s + Math.min(d.unanswered, d.enquiries), 0);
  const answered = E - U;
  const avgMin = answered ? Math.round(a.days.reduce((s, d) => s + d.avgMin * Math.max(0, d.enquiries - d.unanswered), 0) / answered) : 0;
  const current = a.days.reduce((s, d) => s + Math.max(0, d.enquiries - d.unanswered) * p0 * factor(d.avgMin), 0);
  const withBot = E * p0 * 0.95;
  const lost = Math.max(0, withBot - current);
  return { E, U, avgMin, current, withBot, lost, week: lost * a.bookingValue, month: lost * a.bookingValue * 4.33 };
}

const blankAudit = (): Omit<Audit, "id" | "createdAt"> => ({
  business: "", town: "", contact: "", phone: "", requested: false,
  days: DAYS.map((day) => ({ day, enquiries: 0, unanswered: 0, avgMin: 0 })), bookingValue: 90, convFast: 30,
});

export function AuditView() {
  const audits = useCollection<Audit>(COL.audits);
  const [selId, setSelId] = useState<string>("");
  const [draft, setDraft] = useState<Audit | null>(null);
  const [busy, setBusy] = useState(false);
  const current = draft ?? audits.find((a) => a.id === selId) ?? null;

  function edit(patch: Partial<Audit>) { if (current) setDraft({ ...current, ...patch }); }
  function editDay(i: number, k: "enquiries" | "unanswered" | "avgMin", v: string) {
    if (!current) return;
    setDraft({ ...current, days: current.days.map((d, j) => (j === i ? { ...d, [k]: Math.max(0, Number(v) || 0) } : d)) });
  }
  async function save() {
    if (!current) return;
    if (!current.business.trim()) { toast("Add the business name."); return; }
    await put(COL.audits, current);
    setSelId(current.id);
    setDraft(null);
    toast("Audit saved.");
  }
  async function write() {
    if (!current) return;
    if (!current.requested) { toast("Only send the audit to businesses that asked for it (LSSI)."); return; }
    setBusy(true);
    const r = computeAudit(current);
    const res = await aiText(
      `Write a one-page "How many enquiries are you missing?" audit for ${current.business} in ${current.town}, Tenerife, in plain English, max 180 words, no markdown headings. Facts from their own 7-day log: ${r.E} enquiries, ${r.U} never answered, average reply ${r.avgMin} minutes, average booking ${eur(current.bookingValue)}, conversion when answered within 5 minutes ${current.convFast}%. Our model estimates ${r.lost.toFixed(1)} lost bookings a week, about ${eur(Math.round(r.week))} a week or ${eur(Math.round(r.month))} a month. Call it an estimate, explain the assumption in one sentence, then explain how an AI WhatsApp receptionist answers in seconds in the guest's language and hands tricky chats to them. End with an offer of a free 30-day pilot. No guarantees.`,
      () => demoAudit(current, r),
    );
    const next = { ...current, text: res.data, live: res.live };
    await put(COL.audits, next);
    setDraft(null);
    setSelId(next.id);
    setBusy(false);
    if (res.error) toast(res.error);
  }
  async function toLead() {
    if (!current) return;
    await create<Client>("clients", {
      name: current.business, kind: "Excursions", town: current.town, contact: current.contact, phone: current.phone,
      stage: "lead", subs: [], consents: [], languages: ["es", "en"],
      notes: `Missed-enquiries audit: about ${computeAudit(current).lost.toFixed(1)} lost bookings a week. Offer WhatsApp Receptionist pilot.`,
    });
    toast(`${current.business} added to Clients as a lead.`);
  }

  const r = current ? computeAudit(current) : null;
  return (
    <div className="stack">
      <div className="banner small"><span><strong>Lead magnet:</strong> a free 7-day log of enquiries and reply times. Offer it in person or to people who ask; never cold email (LSSI).</span></div>
      <div className="split">
        <Card title="Audits" aside={<Button small kind="primary" onClick={() => setDraft({ ...blankAudit(), id: "aud-" + Date.now().toString(36), createdAt: now() })}>New audit</Button>}>
          {audits.length ? (
            <div className="stack-sm">
              {audits.map((a) => {
                const x = computeAudit(a);
                return (
                  <button key={a.id} type="button" className={"chip" + (current?.id === a.id ? " chip-on" : "")} style={{ textAlign: "left", borderRadius: "var(--radius-md)" }} onClick={() => { setDraft(null); setSelId(a.id); }}>
                    {a.business} · {a.town} · {x.lost.toFixed(1)} lost/week
                  </button>
                );
              })}
            </div>
          ) : <Empty>No audits yet. Start one when an operator agrees to log a week of enquiries.</Empty>}
        </Card>
        {current && r ? (
          <div className="stack">
            <Card title={current.business || "New audit"} aside={<>
              {draft && <Button small kind="ghost" onClick={() => setDraft(null)}>Discard</Button>}
              <Button small kind="primary" onClick={save} disabled={!draft}>Save</Button>
            </>}>
              <div className="form-grid">
                <Field label="Business"><Input id="au-b" value={current.business} onChange={(v) => edit({ business: v })} /></Field>
                <Field label="Town"><Input id="au-t" value={current.town} onChange={(v) => edit({ town: v })} /></Field>
                <Field label="Contact"><Input id="au-c" value={current.contact} onChange={(v) => edit({ contact: v })} /></Field>
                <Field label="Phone"><Input id="au-p" value={current.phone} onChange={(v) => edit({ phone: v })} /></Field>
                <Field label="Average booking (€)"><Input id="au-v" type="number" min={0} value={current.bookingValue} onChange={(v) => edit({ bookingValue: Number(v) || 0 })} /></Field>
                <Field label="Books when answered in 5 min (%)"><Input id="au-k" type="number" min={0} value={current.convFast} onChange={(v) => edit({ convFast: Math.min(100, Number(v) || 0) })} /></Field>
                <label className="row small field-wide"><input type="checkbox" checked={current.requested} onChange={(e) => edit({ requested: e.target.checked })} /> They asked for this audit (consent to contact them about it)</label>
              </div>
              <Table<Audit["days"][number] & { i: number }>
                rows={current.days.map((d, i) => ({ ...d, i }))}
                rowKey={(d) => d.day}
                cols={[
                  { label: "Day", render: (d) => d.day },
                  { label: "Enquiries", render: (d) => <Input id={`au-e-${d.i}`} type="number" min={0} value={d.enquiries} onChange={(v) => editDay(d.i, "enquiries", v)} /> },
                  { label: "Never answered", render: (d) => <Input id={`au-u-${d.i}`} type="number" min={0} value={d.unanswered} onChange={(v) => editDay(d.i, "unanswered", v)} /> },
                  { label: "Avg reply (min)", render: (d) => <Input id={`au-m-${d.i}`} type="number" min={0} value={d.avgMin} onChange={(v) => editDay(d.i, "avgMin", v)} /> },
                ]}
              />
            </Card>
            <Stats>
              <Stat label="Enquiries in 7 days" value={r.E} sub={`${r.U} never answered`} />
              <Stat label="Average reply" value={`${r.avgMin} min`} />
              <Stat label="Lost bookings / week" value={r.lost.toFixed(1)} sub={`${r.current.toFixed(1)} now vs ${r.withBot.toFixed(1)} with instant replies`} tone="warn" />
              <Stat label="Lost revenue / month" value={eur(Math.round(r.month))} sub={`${eur(Math.round(r.week))} a week`} tone="bad" />
            </Stats>
            <p className="small faint">Estimate. Assumes guests book at the 5-minute rate times 70% when answered in 30 min, 45% within 2 h, 30% within 6 h and 20% later, and that instant replies reach 95% of the fast rate. Unanswered enquiries book elsewhere.</p>
            <Card title="Audit for the prospect" aside={<>
              <Button busy={busy} kind="primary" onClick={write} disabled={!!draft}>Write audit</Button>
              <Button onClick={toLead} disabled={!!draft}>Add as lead</Button>
            </>}>
              {draft && <p className="small muted">Save the figures first.</p>}
              {current.text ? <AiOutput text={current.text} live={current.live} /> : <Empty>No write-up yet. It becomes a one-page case for the pilot.</Empty>}
            </Card>
          </div>
        ) : (
          <Empty>Pick an audit or start a new one.</Empty>
        )}
      </div>
    </div>
  );
}

function demoAudit(a: Audit, r: ReturnType<typeof computeAudit>) {
  return `How many enquiries is ${a.business} missing?

In 7 days you logged ${r.E} enquiries on WhatsApp, Instagram and phone. ${r.U} never got an answer, and the rest waited ${r.avgMin} minutes on average. Most tourists book whoever answers first.

Our estimate: about ${r.lost.toFixed(1)} lost bookings a week, roughly ${eur(Math.round(r.week))} a week or ${eur(Math.round(r.month))} a month at your average booking of ${eur(a.bookingValue)}. It assumes ${a.convFast}% of fast-answered enquiries book and fewer book as replies get slower. It is an estimate, not a promise.

What changes with an AI receptionist: it replies within seconds in English, German, Italian or Spanish, answers only from your prices, times and rules, checks your seats, sends a payment link and reminders, and passes anything tricky to your phone with a summary.

Try it free for 30 days. We set it up with your FAQ and compare the numbers at the end.`;
}
