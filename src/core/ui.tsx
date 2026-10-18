// Shared UI kit. Modules build only from these plus the utility classes in styles.css.
import { useState, useEffect, type ReactNode, type CSSProperties } from "react";
import { useAiMode, useAiProvider } from "./ai";
import { LANGS } from "./plans";
import type { Lang, Client } from "./types";

export type ThemePref = "light" | "dark" | "system";
declare global {
  interface Window { PolarTheme?: { get(): ThemePref; set(p: ThemePref): void; mount(el: HTMLElement, lang?: string): void } }
}

// Lucide-style icons (24px grid, 2px round strokes, currentColor). Use <Icon name="calendar" /> instead of emoji or symbols.
const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16.5" rx="3" /><path d="M8 2.5v4M16 2.5v4M3 10h18" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-4.5-4.5L6 21" /></>,
  "message-circle": <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5A8.4 8.4 0 1 1 21 11.5Z" />,
  store: <><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5 12.5V20h14v-7.5" /><path d="M10 20v-4.5h4V20" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  "check-circle": <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 3 3 5-6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  "alert-triangle": <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  monitor: <><rect x="2.5" y="4" width="19" height="13" rx="2.5" /><path d="M8 21h8M12 17v4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>,
  heart: <path d="M12 20.5s-8.5-5-8.5-11A4.7 4.7 0 0 1 12 6.7 4.7 4.7 0 0 1 20.5 9.5c0 6-8.5 11-8.5 11Z" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />,
  video: <><rect x="2.5" y="5.5" width="13" height="13" rx="3" /><path d="m15.5 10 6-3.5v11l-6-3.5" /></>,
  receipt: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="3" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  "map-pin": <><path d="M20 10.5c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10.5" r="3" /></>,
  phone: <path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 3.8 2 2 0 0 1 3.1 1.6h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.5a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />,
  link: <><path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1" /><path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1" /></>,
  sparkles: <><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" /><path d="M19 15v4M17 17h4" /></>,
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof ICONS;

export function Icon(props: { name: IconName; size?: "sm" | "md" | "lg"; className?: string; label?: string }) {
  return (
    <svg className={"pm-ic" + (props.size === "sm" ? " pm-ic--sm" : props.size === "lg" ? " pm-ic--lg" : "") + (props.className ? " " + props.className : "")}
      viewBox="0 0 24 24" role={props.label ? "img" : undefined} aria-label={props.label} aria-hidden={props.label ? undefined : true}>
      {ICONS[props.name]}
    </svg>
  );
}

/** Light / Dark / System selector (brand/theme.js). `compact` shows icons only. */
export function ThemeSelect(props: { compact?: boolean }) {
  const [pref, setPref] = useState<ThemePref>(() => window.PolarTheme?.get() ?? "system");
  useEffect(() => {
    const h = () => setPref(window.PolarTheme?.get() ?? "system");
    window.addEventListener("polar-theme", h);
    return () => window.removeEventListener("polar-theme", h);
  }, []);
  const es = document.documentElement.lang.startsWith("es");
  const opts: { id: ThemePref; label: string; icon: IconName }[] = [
    { id: "light", label: es ? "Claro" : "Light", icon: "sun" },
    { id: "dark", label: es ? "Oscuro" : "Dark", icon: "moon" },
    { id: "system", label: es ? "Sistema" : "System", icon: "monitor" },
  ];
  return (
    <div className={"pm-theme" + (props.compact ? " pm-theme--compact" : "")} role="radiogroup" aria-label={es ? "Tema" : "Theme"}>
      {opts.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={pref === o.id} aria-label={o.label} title={o.label}
          onClick={() => { window.PolarTheme?.set(o.id); setPref(o.id); }}>
          <Icon name={o.icon} size="sm" />{!props.compact && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Page(props: { title: string; avatar?: ReactNode; plan?: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div className="row" style={{ gap: 14, alignItems: "center", minWidth: 0 }}>
          {props.avatar}
          <div className="page-titles">
            {props.plan && <div className="eyebrow">{props.plan}</div>}
            <h1>{props.title}</h1>
            {props.intro && <p className="intro">{props.intro}</p>}
          </div>
        </div>
        {props.actions && <div className="row wrap">{props.actions}</div>}
      </header>
      {props.children}
    </div>
  );
}

export function Card(props: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={"card " + (props.className ?? "")} style={props.style}>
      {(props.title || props.aside) && (
        <div className="card-head">
          {props.title && <h2>{props.title}</h2>}
          {props.aside && <div className="row wrap">{props.aside}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

type BtnKind = "primary" | "secondary" | "ghost" | "danger";
export function Button(props: {
  kind?: BtnKind; onClick?: () => void; disabled?: boolean; busy?: boolean; children: ReactNode;
  type?: "button" | "submit"; small?: boolean; title?: string;
}) {
  return (
    <button
      type={props.type ?? "button"}
      title={props.title}
      className={`btn btn-${props.kind ?? "secondary"}${props.small ? " btn-sm" : ""}`}
      disabled={props.disabled || props.busy}
      onClick={props.onClick}
    >
      {props.busy && <span className="spinner" aria-hidden />}
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={"field" + (props.wide ? " field-wide" : "")}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Input(props: { id: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string; min?: number; step?: number }) {
  return <input id={props.id} className="input" type={props.type ?? "text"} value={props.value} placeholder={props.placeholder}
    min={props.min} step={props.step} onChange={(e) => props.onChange(e.target.value)} />;
}

export function TextArea(props: { id: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea id={props.id} className="input" rows={props.rows ?? 4} value={props.value} placeholder={props.placeholder}
    onChange={(e) => props.onChange(e.target.value)} />;
}

export function Select<T extends string>(props: { id: string; value: T; onChange: (v: T) => void; options: (T | { value: T; label: string })[] }) {
  return (
    <select id={props.id} className="input" value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
      {props.options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

export function Form(props: { children: ReactNode; onSubmit: () => void }) {
  return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}>{props.children}</form>;
}

export function Tabs<T extends string>(props: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={props.value === t.id} className="tab" onClick={() => props.onChange(t.id)}>
          {t.label}{t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";
export function Badge(props: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${props.tone ?? "neutral"}`}>{props.children}</span>;
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className={"stat" + (props.tone ? ` stat-${props.tone}` : "")}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.sub && <div className="stat-sub">{props.sub}</div>}
    </div>
  );
}

export function Stats(props: { children: ReactNode }) {
  return <div className="stats">{props.children}</div>;
}

export function Table<T>(props: {
  rows: T[]; empty?: ReactNode; onRow?: (r: T) => void; rowKey: (r: T) => string;
  cols: { label: string; render: (r: T) => ReactNode; num?: boolean; width?: string }[];
}) {
  if (!props.rows.length) return <Empty>{props.empty ?? "Nothing here yet."}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{props.cols.map((c) => <th key={c.label} className={c.num ? "num" : ""} style={{ width: c.width }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={props.rowKey(r)} className={props.onRow ? "clickable" : ""} onClick={props.onRow ? () => props.onRow!(r) : undefined}>
              {props.cols.map((c) => <td key={c.label} className={c.num ? "num" : ""}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty(props: { children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><p>{props.children}</p>{props.action}</div>;
}

/** Box that shows AI output with a demo/live marker, copy button and optional actions. */
export function AiOutput(props: { text?: string; live?: boolean; error?: string; title?: string; actions?: ReactNode; mono?: boolean }) {
  if (props.text == null) return null;
  return (
    <div className="ai-out">
      <div className="ai-out-head">
        <span className="row">
          {props.title && <strong>{props.title}</strong>}
          <Badge tone={props.live ? "accent" : "neutral"}>{props.live ? "AI draft" : "Demo draft"}</Badge>
        </span>
        <span className="row wrap">{props.actions}<CopyButton text={props.text} /></span>
      </div>
      {props.error && <p className="ai-out-error">{props.error}</p>}
      <div className={props.mono ? "ai-out-body mono" : "ai-out-body"}>{props.text}</div>
    </div>
  );
}

export function CopyButton(props: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button small kind="ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(props.text); setDone(true); setTimeout(() => setDone(false), 1500); }
      catch { toast("Copy was blocked. Select the text and copy it by hand."); }
    }}>{done ? "Copied" : props.label ?? "Copy"}</Button>
  );
}

export function LangPicker(props: { value: Lang[]; onChange: (v: Lang[]) => void; options?: Lang[] }) {
  const opts = props.options ?? (Object.keys(LANGS) as Lang[]);
  return (
    <div className="chips">
      {opts.map((l) => {
        const on = props.value.includes(l);
        return (
          <button key={l} type="button" className={"chip" + (on ? " chip-on" : "")} aria-pressed={on}
            onClick={() => props.onChange(on ? props.value.filter((x) => x !== l) : [...props.value, l])}>
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

export function LangTag(props: { lang: string }) {
  return <span className="lang-tag" title={LANGS[props.lang as Lang] ?? props.lang}>{props.lang.toUpperCase()}</span>;
}

export function ClientPicker(props: { id: string; clients: Client[]; value: string; onChange: (id: string) => void; allowNone?: string }) {
  return (
    <select id={props.id} className="input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.allowNone != null && <option value="">{props.allowNone}</option>}
      {props.clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.town}</option>)}
    </select>
  );
}

export function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!props.open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [props.open]);
  if (!props.open) return null;
  return (
    <div className="modal-back" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>{props.title}</h2><Button small kind="ghost" onClick={props.onClose}>Close</Button></div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/** Inline confirm (the viewer blocks window.confirm). */
export function ConfirmButton(props: { label: string; confirm: string; onConfirm: () => void; kind?: BtnKind }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button small kind={props.kind ?? "ghost"} onClick={() => setAsking(true)}>{props.label}</Button>;
  return (
    <span className="row">
      <Button small kind="danger" onClick={() => { setAsking(false); props.onConfirm(); }}>{props.confirm}</Button>
      <Button small kind="ghost" onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  );
}

export function AiModePill() {
  const m = useAiMode();
  const { provider, model } = useAiProvider();
  const label = m === "live" ? (provider === "openrouter" ? "AI on · OpenRouter free" : "AI on · Claude") : m === "demo" ? "Demo mode" : "Connecting";
  const title = m === "demo" ? "No AI connection here, so AI features return example output"
    : provider === "openrouter" ? `Free OpenRouter models${model ? ` · last answer from ${model}` : ""}` : "AI features call Claude";
  return <span className={"mode-pill mode-" + m} title={title}>{label}</span>;
}

// Toasts
type ToastMsg = { id: number; text: string };
let toasts: ToastMsg[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text }];
  toastListeners.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); toastListeners.forEach((l) => l()); }, 3200);
}
export function Toasts() {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((x) => x + 1); toastListeners.add(l); return () => void toastListeners.delete(l); }, []);
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>;
}

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
