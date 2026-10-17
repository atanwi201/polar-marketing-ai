// Shared UI kit. Modules build only from these plus the utility classes in styles.css.
import { useState, useEffect, type ReactNode, type CSSProperties } from "react";
import { useAiMode, useAiProvider } from "./ai";
import { LANGS } from "./plans";
import type { Lang, Client } from "./types";

export function Page(props: { title: string; plan?: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-titles">
          {props.plan && <div className="eyebrow">{props.plan}</div>}
          <h1>{props.title}</h1>
          {props.intro && <p className="intro">{props.intro}</p>}
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
