// Records live in the artifact's shared db when the page runs on claude.ai, otherwise in localStorage.
// Every collection is a flat list of records keyed by id. Use the useCollection hook from components.
import { useEffect, useState, useCallback } from "react";
import { useCapability } from "./claude";
import type { Rec } from "./types";

type Listener = () => void;
type Backend = "loading" | "cloud" | "browser";

const cache = new Map<string, Map<string, Rec>>();
const listeners = new Map<string, Set<Listener>>();
let db: any = null;
let backend: Backend = "loading";
const ready = useCapability("db").then((d) => {
  db = d;
  backend = d ? "cloud" : "browser";
  globalListeners.forEach((l) => l());
});
const globalListeners = new Set<Listener>();

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

function emit(col: string) {
  listeners.get(col)?.forEach((l) => l());
  globalListeners.forEach((l) => l());
}

function lsRead(col: string): Rec[] {
  try { return JSON.parse(localStorage.getItem("isla:" + col) || "[]"); } catch { return []; }
}
function lsWrite(col: string) {
  try { localStorage.setItem("isla:" + col, JSON.stringify([...(cache.get(col)?.values() ?? [])])); } catch { /* storage blocked */ }
}

const loading = new Map<string, Promise<void>>();

function ensure(col: string): Promise<void> {
  let p = loading.get(col);
  if (p) return p;
  if (!cache.has(col)) cache.set(col, new Map());
  p = ready.then(() => {
    if (db) {
      // Resolve once the first snapshot lands so writes never race the initial load.
      return new Promise<void>((resolve) => {
        db.collection(col).onSnapshot(
          (snap: any) => {
            const m = new Map<string, Rec>();
            for (const d of snap.docs) m.set(d.id, { ...d.data(), id: d.id });
            // Records with an unsent local edit keep the local version.
            for (const [id, rec] of cache.get(col) ?? []) if (pending.has(`${col}/${id}`)) m.set(id, rec);
            cache.set(col, m);
            emit(col);
            resolve();
          },
          () => resolve(), // keep the cache on errors
        );
      });
    }
    cache.set(col, new Map(lsRead(col).map((r) => [r.id, r])));
    emit(col);
  });
  loading.set(col, p);
  return p;
}

export function getAll<T extends Rec>(col: string): T[] {
  void ensure(col);
  return [...(cache.get(col)?.values() ?? [])] as T[];
}

export async function put<T extends Rec>(col: string, rec: T): Promise<T> {
  await ensure(col);
  cache.get(col)!.set(rec.id, rec);
  emit(col);
  if (db) scheduleCloudWrite(col, rec.id);
  else lsWrite(col);
  return rec;
}

// Coalesce rapid edits (typing) into one cloud write per record.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleCloudWrite(col: string, id: string) {
  const key = `${col}/${id}`;
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    const rec = cache.get(col)?.get(id);
    if (rec) db.doc(key).set(JSON.parse(JSON.stringify(rec))).catch(() => { /* next edit retries */ });
  }, 500));
}

export async function remove(col: string, id: string) {
  await ensure(col);
  cache.get(col)!.delete(id);
  emit(col);
  clearTimeout(pending.get(`${col}/${id}`));
  if (db) await db.doc(`${col}/${id}`).delete();
  else lsWrite(col);
}

/** Create a record with id/createdAt filled in. */
export function create<T extends Rec>(col: string, data: Omit<T, "id" | "createdAt">): Promise<T> {
  return put(col, { ...data, id: uid(), createdAt: now() } as T);
}

/** Live list of a collection, newest first. */
export function useCollection<T extends Rec>(col: string): T[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    if (!listeners.has(col)) listeners.set(col, new Set());
    listeners.get(col)!.add(l);
    void ensure(col).then(l); // the first load may finish before this effect subscribed
    return () => void listeners.get(col)!.delete(l);
  }, [col]);
  return getAll<T>(col).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function useBackend(): Backend {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    globalListeners.add(l);
    void ready.then(l);
    return () => void globalListeners.delete(l);
  }, []);
  return backend;
}

/** Re-render on any store change (for cross-collection views like the dashboard). */
export function useStoreVersion() {
  useBackend();
}

export const storeReady = ready;
export const collections = () => [...cache.keys()];

/** Wait until a collection has loaded (before reading it outside a component). */
export const loadCollection = (col: string) => ensure(col);
