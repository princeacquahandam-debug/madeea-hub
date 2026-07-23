/**
 * Demo-mode writes.
 *
 * Every mutation in hooks.ts was gated on `if (!supabase) return;` — correct for a
 * read-only fallback, but it meant that in the published preview a dozen buttons
 * (delete a client, toggle an automation, triage an email, change a role) silently
 * did nothing. A button that looks live and isn't is worse than no button.
 *
 * This is a thin localStorage overlay applied on top of the seed data: creates,
 * patches and deletes, per entity. Live mode never touches it.
 */

export type DemoEntity =
  | "clients" | "automations" | "messages" | "members" | "reminders" | "sop_runs"
  // Memory (0017) uses this overlay for two cases, not one: demo mode, and a live
  // workspace where the migration hasn't been applied yet. In the latter, losing
  // what someone just typed would be the worst outcome, so writes land here.
  | "memories"
  // Notes (0019) uses the same overlay for the same two cases.
  | "notes";

interface Writes {
  created: Partial<Record<DemoEntity, unknown[]>>;
  patched: Partial<Record<DemoEntity, Record<string, Record<string, unknown>>>>;
  deleted: Partial<Record<DemoEntity, string[]>>;
}

const KEY = "madeea-demo-writes";
const EMPTY: Writes = { created: {}, patched: {}, deleted: {} };

const load = (): Writes => {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return EMPTY;
  }
};
const save = (w: Writes) => localStorage.setItem(KEY, JSON.stringify(w));

export const demoId = (): string => `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function demoCreate(entity: DemoEntity, record: unknown): void {
  const w = load();
  w.created[entity] = [record, ...(w.created[entity] ?? [])];
  save(w);
}

export function demoPatch(entity: DemoEntity, id: string, patch: Record<string, unknown>): void {
  const w = load();
  const bucket = w.patched[entity] ?? {};
  bucket[id] = { ...(bucket[id] ?? {}), ...patch };
  w.patched[entity] = bucket;
  save(w);
}

export function demoDelete(entity: DemoEntity, id: string): void {
  const w = load();
  w.deleted[entity] = [...(w.deleted[entity] ?? []), id];
  // A record created in demo and then deleted should just disappear, not linger
  // in the created list forever.
  w.created[entity] = (w.created[entity] ?? []).filter(
    (r) => (r as { id?: string; user_id?: string }).id !== id && (r as { user_id?: string }).user_id !== id,
  );
  save(w);
}

/** Overlay the local writes on top of the seed list. `idKey` is user_id for members. */
export function applyDemo<T>(entity: DemoEntity, base: T[], idKey: keyof T = "id" as keyof T): T[] {
  const w = load();
  const deleted = new Set(w.deleted[entity] ?? []);
  const patched = w.patched[entity] ?? {};
  const created = (w.created[entity] ?? []) as T[];

  return [...created, ...base]
    .filter((r) => !deleted.has(String(r[idKey])))
    .map((r) => {
      const p = patched[String(r[idKey])];
      return p ? ({ ...r, ...p } as T) : r;
    });
}
