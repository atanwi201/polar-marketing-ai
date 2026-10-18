// Reservations tab for one business: setup, public booking link, bookings list and manual entry.
// Server side: server/bookings-routes.mjs (owner scope /api/studio/bookings).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Badge, Tabs, Field, Input, TextArea, Select, Empty, CopyButton, Stat, Stats, toast, type Tone } from "../core/ui";
import { bcall, berr, MOVES, type BConfig, type Booking, type BookingsData, type BKind, type BLang, type BStatus, type RoomType, type WeekDay } from "./bookings-api";

const STATUS_TONE: Record<BStatus, Tone> = { pending: "warn", confirmed: "good", cancelled: "neutral", no_show: "bad", completed: "info" };
const STATUS_LABEL: Record<BStatus, string> = { pending: "Pending", confirmed: "Confirmed", cancelled: "Cancelled", no_show: "No-show", completed: "Completed" };
const ACTION_LABEL = (from: BStatus, to: BStatus) => (to === "confirmed" ? (from === "pending" ? "Confirm" : "Reconfirm") : to === "cancelled" ? "Cancel" : to === "no_show" ? "No-show" : "Complete");
const DAYS = [{ d: 1, n: "Monday" }, { d: 2, n: "Tuesday" }, { d: 3, n: "Wednesday" }, { d: 4, n: "Thursday" }, { d: 5, n: "Friday" }, { d: 6, n: "Saturday" }, { d: 0, n: "Sunday" }];
const num = (v: string | number, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const uid = () => "r" + Math.random().toString(36).slice(2, 9);

/** The business's current local date and minutes since midnight. */
function localNow(tz: string) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  } catch { const d = new Date(); return { date: d.toISOString().slice(0, 10), minutes: d.getHours() * 60 + d.getMinutes() }; }
}
const fmtDay = (d?: string) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");
const whenKey = (b: Booking) => (b.kind === "table" ? `${b.date} ${b.time}` : `${b.checkIn} 00:00`);

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BookingsData };

export function BookingsPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [s, setS] = useState<Load>({ state: "loading" });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    void bcall<BookingsData>("GET", `?clientId=${encodeURIComponent(clientId)}`).then((r) => {
      if (n !== seq.current) return;
      setS(r.kind === "ok" ? { state: "ok", data: r.data } : { state: "error", message: berr(r) });
    });
  }, [clientId]);
  useEffect(() => { setS({ state: "loading" }); load(); return () => { seq.current++; }; }, [load]);

  if (s.state === "loading") return <div className="loy-skel-wrap" aria-busy="true" aria-label="Loading"><div className="loy-skel" style={{ height: 120 }} /><div className="loy-skel" style={{ height: 240 }} /></div>;
  if (s.state === "error") return <Empty action={<Button onClick={load}>Try again</Button>}>{s.message}</Empty>;
  const { config, bookings } = s.data;
  const setConfig = (c: BConfig) => setS({ state: "ok", data: { ...s.data, config: c } });
  const setBookings = (b: Booking[]) => setS({ state: "ok", data: { ...s.data, bookings: b } });
  return (
    <div className="stack">
      <SetupCard clientId={clientId} clientName={clientName} config={config} onSaved={(c) => { setConfig(c); load(); }} />
      <LinkCard config={config} />
      <BookingList clientId={clientId} config={config} bookings={bookings} onChange={setBookings} onRefresh={load} />
    </div>
  );
}

// ---------- Setup ----------

function SetupCard({ clientId, clientName, config, onSaved }: { clientId: string; clientName: string; config: BConfig; onSaved: (c: BConfig) => void }) {
  const [d, setD] = useState<BConfig>(config);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setD(config); }, [config]);
  const dirty = useMemo(() => JSON.stringify(pick(d)) !== JSON.stringify(pick(config)), [d, config]);
  const up = (p: Partial<BConfig>) => setD((x) => ({ ...x, ...p }));
  const upT = (p: Partial<BConfig["table"]>) => setD((x) => ({ ...x, table: { ...x.table, ...p } }));
  const upR = (p: Partial<BConfig["room"]>) => setD((x) => ({ ...x, room: { ...x.room, ...p } }));

  const put = async (body: unknown, okMsg: string) => {
    setSaving(true); setErr("");
    const r = await bcall<BConfig>("PUT", `/config?clientId=${encodeURIComponent(clientId)}`, body);
    setSaving(false);
    if (r.kind !== "ok") { const m = berr(r); setErr(m); toast(m); return false; }
    onSaved(r.data); toast(okMsg); return true;
  };
  const toggleEnabled = async () => { const next = !d.enabled; up({ enabled: next }); if (!(await put({ enabled: next }, next ? "Online bookings are on." : "Online bookings are off."))) up({ enabled: !next }); };
  const save = () => void put(pick(d), "Booking settings saved.");
  const toggleLang = (l: BLang) => { const has = d.langs.includes(l); const langs = has ? d.langs.filter((x) => x !== l) : [...d.langs, l]; if (langs.length) up({ langs }); };
  const isTable = d.kind === "table";

  return (
    <Card title="Online bookings" aside={<Badge tone={config.enabled ? "good" : "neutral"}>{config.enabled ? "Open" : "Off"}</Badge>}>
      <div className="stack">
        <div className="loy-box">
          <label className="row"><input type="checkbox" checked={d.enabled} disabled={saving} onChange={() => void toggleEnabled()} />
            <span className="strong">Accept online bookings for {clientName}</span></label>
          <p className="small muted">When off, the booking link shows a "not open" message. You can still add bookings by hand below.</p>
        </div>

        <div className="stack-sm">
          <span className="field-label">What do they take bookings for?</span>
          <div className="seg-mini" role="group" aria-label="Booking type">
            <button type="button" aria-pressed={isTable} onClick={() => up({ kind: "table" })}>Restaurant tables</button>
            <button type="button" aria-pressed={!isTable} onClick={() => up({ kind: "room" })}>Hotel rooms</button>
          </div>
          {d.kind !== config.kind && config.stats.upcoming > 0 && <p className="loy-note">There are {config.stats.upcoming} upcoming bookings of the current type. Changing the type does not remove them.</p>}
        </div>

        {isTable ? <TableSetup d={d} upT={upT} /> : <RoomSetup d={d} upR={upR} />}

        <div className="grid-2">
          <div className="stack">
            <label className="row small"><input type="checkbox" checked={d.autoConfirm} onChange={(e) => up({ autoConfirm: e.target.checked })} /> Confirm bookings automatically</label>
            <span className="small muted">{d.autoConfirm ? "Guests get a confirmed booking straight away." : "New bookings wait as Pending until you confirm them."}</span>
            <div className="stack-sm">
              <span className="field-label">Languages on the booking page</span>
              <div className="row wrap">
                {(["es", "en"] as BLang[]).map((l) => <label key={l} className="row small"><input type="checkbox" checked={d.langs.includes(l)} onChange={() => toggleLang(l)} /> {l === "es" ? "Español" : "English"}</label>)}
              </div>
            </div>
            <Field label="How far ahead can guests book (days)"><Input id="bk-adv" type="number" min={1} value={d.advanceDays} onChange={(v) => up({ advanceDays: num(v, 1) })} /></Field>
          </div>
          <Field label="Notice shown on the booking page" hint="For example: allergies, parking, or a dress code. Up to 300 characters."><TextArea id="bk-notice" rows={5} value={d.notice} onChange={(v) => up({ notice: v.slice(0, 300) })} /></Field>
        </div>

        {err && <p className="small" role="alert" style={{ color: "var(--bad, #c0392b)" }}>{err}</p>}
        <div className="row wrap">
          <Button kind="primary" busy={saving} disabled={!dirty} onClick={save}>Save settings</Button>
          {dirty && <Button kind="ghost" onClick={() => setD(config)}>Discard changes</Button>}
          {!dirty && <span className="small faint">All changes saved.</span>}
        </div>
      </div>
    </Card>
  );
}

const pick = (c: BConfig) => ({ enabled: c.enabled, kind: c.kind, autoConfirm: c.autoConfirm, langs: c.langs, advanceDays: c.advanceDays, notice: c.notice, closedDates: c.closedDates, timezone: c.timezone, table: c.table, room: c.room });

function TableSetup({ d, upT }: { d: BConfig; upT: (p: Partial<BConfig["table"]>) => void }) {
  const t = d.table;
  const setDay = (day: number, ranges: [string, string][]) => upT({ week: t.week.map((w: WeekDay) => (w.day === day ? { ...w, ranges } : w)) });
  return (
    <div className="stack">
      <div className="loy-box">
        <h3>Opening hours</h3>
        <p className="small muted">Guests can book between these times. Add a second range for a lunch and dinner service. Leave a day empty to close it.</p>
        {DAYS.map(({ d: day, n }) => {
          const ranges = t.week.find((w) => w.day === day)?.ranges ?? [];
          return (
            <div key={day} className="bk-day">
              <span className="strong bk-dayname">{n}</span>
              <div className="bk-ranges">
                {ranges.length === 0 && <span className="small faint">Closed</span>}
                {ranges.map((r, i) => (
                  <span key={i} className="row bk-range">
                    <input className="input" type="time" aria-label={`${n} opens ${i + 1}`} value={r[0]} onChange={(e) => setDay(day, ranges.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
                    <span className="muted">to</span>
                    <input className="input" type="time" aria-label={`${n} closes ${i + 1}`} value={r[1]} onChange={(e) => setDay(day, ranges.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
                    <Button small kind="ghost" title="Remove this time range" onClick={() => setDay(day, ranges.filter((_, j) => j !== i))}>Remove</Button>
                  </span>
                ))}
                {ranges.length < 2 && <span><Button small kind="ghost" onClick={() => setDay(day, [...ranges, ranges.length ? ["20:00", "23:00"] : ["13:00", "16:00"]])}>{ranges.length ? "Add second range" : "Open this day"}</Button></span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid-3">
        <Field label="Seats in the restaurant" hint="Total guests at the same time."><Input id="bk-seats" type="number" min={1} value={t.seats} onChange={(v) => upT({ seats: num(v, 1) })} /></Field>
        <Field label="Smallest party"><Input id="bk-minp" type="number" min={1} value={t.minParty} onChange={(v) => upT({ minParty: num(v, 1) })} /></Field>
        <Field label="Largest party online" hint="Bigger groups call you."><Input id="bk-maxp" type="number" min={1} value={t.maxParty} onChange={(v) => upT({ maxParty: num(v, 1) })} /></Field>
        <Field label="Time between slots"><Select id="bk-slot" value={String(t.slotMinutes)} onChange={(v) => upT({ slotMinutes: num(v, 30) })} options={[{ value: "15", label: "Every 15 minutes" }, { value: "30", label: "Every 30 minutes" }, { value: "60", label: "Every hour" }]} /></Field>
        <Field label="Table time (minutes)" hint="How long a booking holds its seats."><Input id="bk-dur" type="number" min={15} step={15} value={t.durationMinutes} onChange={(v) => upT({ durationMinutes: num(v, 90) })} /></Field>
        <Field label="Minimum notice (minutes)" hint="Same-day bookings close this long before."><Input id="bk-notice-min" type="number" min={0} step={15} value={t.minNoticeMinutes} onChange={(v) => upT({ minNoticeMinutes: num(v, 0) })} /></Field>
      </div>
    </div>
  );
}

function RoomSetup({ d, upR }: { d: BConfig; upR: (p: Partial<BConfig["room"]>) => void }) {
  const r = d.room;
  const setType = (i: number, p: Partial<RoomType>) => upR({ roomTypes: r.roomTypes.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <div className="stack">
      <div className="loy-box">
        <h3>Room types</h3>
        <p className="small muted">Each type is a group of identical rooms. Guests pick a type, not a room number.</p>
        {r.roomTypes.length === 0 && <p className="small faint">No room types yet. Add one so guests have something to book.</p>}
        {r.roomTypes.map((t, i) => (
          <div key={t.id} className="bk-rt">
            <div className="grid-3">
              <Field label="Name"><Input id={`bk-rt-n${i}`} value={t.name} onChange={(v) => setType(i, { name: v })} /></Field>
              <Field label="How many rooms"><Input id={`bk-rt-c${i}`} type="number" min={1} value={t.count} onChange={(v) => setType(i, { count: num(v, 1) })} /></Field>
              <Field label="Max guests"><Input id={`bk-rt-g${i}`} type="number" min={1} value={t.maxGuests} onChange={(v) => setType(i, { maxGuests: num(v, 1) })} /></Field>
              <Field label="Price per night (EUR)" hint="Shown to guests. Payment is not taken online."><Input id={`bk-rt-p${i}`} type="number" min={0} step={1} value={t.priceEur} onChange={(v) => setType(i, { priceEur: num(v, 0) })} /></Field>
              <Field label="Description" wide><Input id={`bk-rt-d${i}`} value={t.description} onChange={(v) => setType(i, { description: v })} /></Field>
            </div>
            <div><Button small kind="ghost" onClick={() => upR({ roomTypes: r.roomTypes.filter((_, j) => j !== i) })}>Remove this room type</Button></div>
          </div>
        ))}
        <div><Button small onClick={() => upR({ roomTypes: [...r.roomTypes, { id: uid(), name: "", count: 1, maxGuests: 2, priceEur: 0, description: "" }] })}>Add a room type</Button></div>
        {r.roomTypes.some((t) => !t.name.trim()) && <p className="small faint">Room types without a name are dropped when you save.</p>}
      </div>
      <div className="grid-2">
        <Field label="Minimum nights"><Input id="bk-minn" type="number" min={1} value={r.minNights} onChange={(v) => upR({ minNights: num(v, 1) })} /></Field>
        <Field label="Maximum nights"><Input id="bk-maxn" type="number" min={1} value={r.maxNights} onChange={(v) => upR({ maxNights: num(v, 1) })} /></Field>
        <Field label="Check-in from"><Input id="bk-ci" type="time" value={r.checkIn} onChange={(v) => upR({ checkIn: v })} /></Field>
        <Field label="Check-out by"><Input id="bk-co" type="time" value={r.checkOut} onChange={(v) => upR({ checkOut: v })} /></Field>
      </div>
    </div>
  );
}

// ---------- Public link ----------

function LinkCard({ config }: { config: BConfig }) {
  return (
    <Card title="Booking link">
      {!config.enabled && <p className="loy-note">Online bookings are off, so this link shows a "not open" message until you turn them on above.</p>}
      <div className="loy-box">
        <p className="small muted">Put this on the website, Instagram bio, Google profile or a poster. Guests pick a {config.kind === "table" ? "day, party size and time" : "stay and room"} and get an email with a link to cancel.</p>
        <div className="loy-link"><span className="mono">{config.bookingUrl}</span></div>
        <div className="row wrap"><CopyButton text={config.bookingUrl} label="Copy link" /><a className="btn btn-secondary btn-sm" href={config.bookingUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open it</a></div>
      </div>
    </Card>
  );
}

// ---------- Bookings list ----------

type Filter = "upcoming" | "pending" | "past" | "closed";

function BookingList({ clientId, config, bookings, onChange, onRefresh }: { clientId: string; config: BConfig; bookings: Booking[]; onChange: (b: Booking[]) => void; onRefresh: () => void }) {
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const now = localNow(config.timezone);
  const active = (b: Booking) => b.status === "pending" || b.status === "confirmed";
  const ended = (b: Booking) => (b.kind === "table" ? whenKey(b) < `${now.date} ${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}` : (b.checkIn ?? "") < now.date);
  const sets: Record<Filter, (b: Booking) => boolean> = {
    upcoming: (b) => active(b) && !ended(b),
    pending: (b) => b.status === "pending",
    past: (b) => b.status === "completed" || (active(b) && ended(b)),
    closed: (b) => b.status === "cancelled" || b.status === "no_show",
  };
  const rows = useMemo(() => {
    const r = bookings.filter(sets[filter]);
    r.sort((a, b) => (filter === "past" || filter === "closed" ? whenKey(b).localeCompare(whenKey(a)) : whenKey(a).localeCompare(whenKey(b))));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, filter, now.date, now.minutes]);
  const count = (f: Filter) => bookings.filter(sets[f]).length;

  const move = async (b: Booking, status: BStatus) => {
    setBusyId(b.id); setRowErr((e) => ({ ...e, [b.id]: "" }));
    const r = await bcall<Booking>("PATCH", `/bookings/${b.id}?clientId=${encodeURIComponent(clientId)}`, { status });
    setBusyId("");
    if (r.kind !== "ok") { setRowErr((e) => ({ ...e, [b.id]: berr(r) })); return; }
    onChange(bookings.map((x) => (x.id === b.id ? r.data : x)));
    toast(`Booking for ${b.name}: ${STATUS_LABEL[status].toLowerCase()}.`);
    onRefresh();
  };

  return (
    <Card title="Bookings" aside={<><Button small kind="ghost" onClick={onRefresh}>Refresh</Button><Button small kind="primary" onClick={() => setAdding((v) => !v)}>{adding ? "Close form" : "Add booking"}</Button></>}>
      <div className="stack">
        <Stats>
          <Stat label="Today" value={config.stats.today} />
          <Stat label="Upcoming" value={config.stats.upcoming} />
          <Stat label="Waiting for you" value={config.stats.pending} tone={config.stats.pending ? "warn" : undefined} />
          <Stat label="No-shows" value={config.stats.noShows} />
        </Stats>
        {adding && <AddBooking clientId={clientId} config={config} onAdded={(b) => { onChange([...bookings, b]); setAdding(false); setFilter("upcoming"); toast("Booking added."); onRefresh(); }} onCancel={() => setAdding(false)} />}
        <Tabs value={filter} onChange={setFilter} tabs={[
          { id: "upcoming", label: "Upcoming", count: count("upcoming") }, { id: "pending", label: "Pending", count: count("pending") },
          { id: "past", label: "Past", count: count("past") }, { id: "closed", label: "Cancelled & no-shows", count: count("closed") },
        ]} />
        {rows.length === 0 ? (
          <Empty action={filter === "upcoming" && !adding ? <Button onClick={() => setAdding(true)}>Add a booking</Button> : undefined}>
            {bookings.length === 0 ? (config.enabled ? "No bookings yet. They show up here as soon as guests use your booking link." : "No bookings yet. Turn on online bookings above, or add one by hand.")
              : filter === "upcoming" ? "Nothing coming up." : filter === "pending" ? "Nothing is waiting for your confirmation." : filter === "past" ? "No past bookings yet." : "No cancelled bookings or no-shows."}
          </Empty>
        ) : (
          <ul className="bk-list">
            {rows.map((b) => (
              <li key={b.id} className="bk-row">
                <div className="bk-main">
                  <div className="row wrap"><span className="strong">{b.name}</span><Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>{b.source === "owner" && <span className="small faint">added by hand</span>}</div>
                  <span className="small">{b.kind === "table" ? <>{fmtDay(b.date)} at {b.time} · {b.party} {b.party === 1 ? "guest" : "guests"}</> : <>{fmtDay(b.checkIn)} to {fmtDay(b.checkOut)} · {b.nights} {b.nights === 1 ? "night" : "nights"} · {b.guests} {b.guests === 1 ? "guest" : "guests"} · {b.roomName}</>}</span>
                  <span className="small muted bk-contact"><a href={`mailto:${b.email}`}>{b.email}</a>{b.phone && <> · <a href={`tel:${b.phone}`}>{b.phone}</a></>}</span>
                  {b.notes && <span className="small muted">Note: {b.notes}</span>}
                  {rowErr[b.id] && <span className="small" role="alert" style={{ color: "var(--bad, #c0392b)" }}>{rowErr[b.id]}</span>}
                </div>
                <div className="row wrap bk-actions">
                  {MOVES[b.status].filter((to) => to !== "no_show" || ended(b)).map((to) => (
                    <Button key={to} small kind={to === "confirmed" ? "primary" : to === "cancelled" ? "danger" : "secondary"} busy={busyId === b.id} onClick={() => void move(b, to)}>{ACTION_LABEL(b.status, to)}</Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ---------- Add by hand ----------

function AddBooking({ clientId, config, onAdded, onCancel }: { clientId: string; config: BConfig; onAdded: (b: Booking) => void; onCancel: () => void }) {
  const today = localNow(config.timezone).date;
  const kind: BKind = config.kind;
  const [f, setF] = useState({ name: "", email: "", phone: "", notes: "", party: 2, date: today, time: "20:00", roomTypeId: config.room.roomTypes[0]?.id ?? "", checkIn: today, checkOut: "", guests: 2 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const submit = async () => {
    setBusy(true); setErr("");
    const common = { name: f.name, email: f.email, phone: f.phone, notes: f.notes, lang: config.langs[0] };
    const body = kind === "table" ? { ...common, party: f.party, date: f.date, time: f.time } : { ...common, roomTypeId: f.roomTypeId, checkIn: f.checkIn, checkOut: f.checkOut, guests: f.guests };
    const r = await bcall<Booking>("POST", `/bookings?clientId=${encodeURIComponent(clientId)}`, body);
    setBusy(false);
    if (r.kind !== "ok") return setErr(berr(r));
    onAdded(r.data);
  };
  return (
    <form className="loy-box" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3>Add a booking</h3>
      <p className="small muted">For walk-ins and phone calls. It is confirmed straight away and uses the same availability as online bookings{kind === "table" ? ", except the minimum notice" : ""}. The guest gets a confirmation email.</p>
      <div className="grid-3">
        <Field label="Guest name"><Input id="bk-a-name" value={f.name} onChange={(v) => set({ name: v })} /></Field>
        <Field label="Email" hint="Needed for the confirmation."><Input id="bk-a-email" type="email" value={f.email} onChange={(v) => set({ email: v })} /></Field>
        <Field label="Phone (optional)"><Input id="bk-a-phone" type="tel" value={f.phone} onChange={(v) => set({ phone: v })} /></Field>
        {kind === "table" ? <>
          <Field label="Date"><Input id="bk-a-date" type="date" value={f.date} onChange={(v) => set({ date: v })} /></Field>
          <Field label="Time" hint="Must match one of your slots."><Input id="bk-a-time" type="time" step={900} value={f.time} onChange={(v) => set({ time: v })} /></Field>
          <Field label="Guests"><Input id="bk-a-party" type="number" min={1} value={f.party} onChange={(v) => set({ party: num(v, 1) })} /></Field>
        </> : <>
          <Field label="Room type"><Select id="bk-a-room" value={f.roomTypeId} onChange={(v) => set({ roomTypeId: v })} options={config.room.roomTypes.length ? config.room.roomTypes.map((t) => ({ value: t.id, label: t.name })) : [{ value: "", label: "No room types yet" }]} /></Field>
          <Field label="Check-in"><Input id="bk-a-in" type="date" value={f.checkIn} onChange={(v) => set({ checkIn: v })} /></Field>
          <Field label="Check-out"><Input id="bk-a-out" type="date" value={f.checkOut} onChange={(v) => set({ checkOut: v })} /></Field>
          <Field label="Guests"><Input id="bk-a-guests" type="number" min={1} value={f.guests} onChange={(v) => set({ guests: num(v, 1) })} /></Field>
        </>}
        <Field label="Notes (optional)" wide><Input id="bk-a-notes" value={f.notes} onChange={(v) => set({ notes: v })} /></Field>
      </div>
      {err && <p className="small" role="alert" style={{ color: "var(--bad, #c0392b)" }}>{err}</p>}
      <div className="row wrap"><Button type="submit" kind="primary" busy={busy}>Add booking</Button><Button kind="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
