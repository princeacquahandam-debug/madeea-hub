import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import * as seed from "@/data/seed";
import { applyDemo } from "@/store/demoWrites";
import { MESSAGE_FETCH_LIMIT } from "@/data/hooks";
import type { MailLabel, MailLabelColor, Message } from "@/types/db";

/**
 * Read state and personal labels for the inbox (Reich's testing, 20 Oct 2026).
 *
 * Kept out of hooks.ts on purpose: useMessages builds an explicit object per
 * row and drops is_read and label_ids, so this file fetches just those two
 * columns for the same rows (same order, same limit) and the inbox merges them
 * in by id. Every hook here works with supabase === null (demo mode) by
 * keeping the same state in localStorage, and none of them throws there.
 */

// ── Palette ──────────────────────────────────────────────────────────────
/** The same seven names 0091 allows. Order is the order the picker shows. */
export const MAIL_LABEL_COLORS: MailLabelColor[] = ["slate", "red", "amber", "green", "blue", "violet", "pink"];

/** Chip classes per colour. A tint plus a darker/lighter text per theme, so it reads in both. */
export const LABEL_CHIP: Record<MailLabelColor, string> = {
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  blue: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
};
/** Solid swatch, for the colour picker and the dot in menus. */
export const LABEL_DOT: Record<MailLabelColor, string> = {
  slate: "bg-slate-500", red: "bg-red-500", amber: "bg-amber-500", green: "bg-emerald-500",
  blue: "bg-sky-500", violet: "bg-violet-500", pink: "bg-pink-500",
};

// ── Unread ───────────────────────────────────────────────────────────────
/**
 * What the sidebar badge counts. Incoming, not opened, not a bulk mailing
 * (newsletters would keep it permanently in the hundreds), and not archived
 * (Done is not "needs you"). The live count query applies the same four.
 */
export const countsAsUnread = (m: Message, isRead: boolean) =>
  m.direction !== "outbound" && !isRead && !m.is_bulk && m.category !== "archive";

// ── Demo store ───────────────────────────────────────────────────────────
interface DemoMail { read: string[]; labels: MailLabel[]; tags: Record<string, string[]> }
const DEMO_KEY = "madeea-demo-mail-labels";
const loadDemo = (): DemoMail => {
  try {
    const v = JSON.parse(localStorage.getItem(DEMO_KEY) || "{}");
    return { read: v.read ?? [], labels: v.labels ?? [], tags: v.tags ?? {} };
  } catch {
    return { read: [], labels: [], tags: {} };
  }
};
const saveDemo = (d: DemoMail) => {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* private window: lives for this session only */ }
};

// ── Query keys ───────────────────────────────────────────────────────────
/* Under ["messages"], so every existing invalidation of the inbox (triage,
   sync, send) refreshes these as well without hooks.ts knowing they exist. */
export const MESSAGE_META_KEY = ["messages", "meta"] as const;
export const UNREAD_COUNT_KEY = ["messages", "unread-count"] as const;
export const MAIL_LABELS_KEY = ["mail-labels"] as const;

export interface MessageMeta {
  /** id -> state. A message missing from the map has unknown state. */
  byId: Record<string, { is_read: boolean; label_ids: string[] }>;
  /** False until 0091 is applied: labels then stay hidden rather than erroring. */
  labelsReady: boolean;
}

// ── Message meta (is_read, label_ids) ────────────────────────────────────
export function useMessageMeta() {
  return useQuery<MessageMeta>({
    queryKey: MESSAGE_META_KEY,
    queryFn: async () => {
      if (!supabase) {
        const d = loadDemo();
        const read = new Set(d.read);
        const byId: MessageMeta["byId"] = {};
        for (const m of applyDemo("messages", seed.MESSAGES)) {
          byId[m.id] = { is_read: read.has(m.id), label_ids: d.tags[m.id] ?? [] };
        }
        return { byId, labelsReady: true };
      }
      const run = (cols: string) => supabase!
        .from("messages")
        .select(cols)
        .order("received_at", { ascending: false })
        .limit(MESSAGE_FETCH_LIMIT);
      let labelsReady = true;
      let res = await run("id,is_read,label_ids");
      // label_ids arrives with 0091. Before that, read state still works.
      if (res.error) { labelsReady = false; res = await run("id,is_read"); }
      if (res.error) throw res.error;
      const byId: MessageMeta["byId"] = {};
      for (const r of (res.data ?? []) as unknown as { id: string; is_read: boolean; label_ids?: string[] | null }[]) {
        byId[r.id] = { is_read: Boolean(r.is_read), label_ids: Array.isArray(r.label_ids) ? r.label_ids : [] };
      }
      return { byId, labelsReady };
    },
    retry: false,
  });
}

/** Unread messages for the sidebar badge. Fresh every minute, and on focus. */
export function useUnreadCount() {
  return useQuery<number>({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: async () => {
      if (!supabase) {
        const read = new Set(loadDemo().read);
        return applyDemo("messages", seed.MESSAGES).filter((m) => countsAsUnread(m, read.has(m.id))).length;
      }
      // Head-only: a count, no rows. RLS limits it to mail this person can see,
      // which is exactly what the inbox lists.
      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false)
        .neq("direction", "outbound")
        .eq("is_bulk", false)
        .neq("category", "archive");
      if (error) return 0; // a badge is not worth an error state
      return count ?? 0;
    },
    refetchInterval: 60_000,
    retry: false,
  });
}

function patchMeta(qc: QueryClient, fn: (byId: MessageMeta["byId"]) => void) {
  qc.setQueryData<MessageMeta>(MESSAGE_META_KEY, (prev) => {
    if (!prev) return prev;
    const byId = { ...prev.byId };
    fn(byId);
    return { ...prev, byId };
  });
}

/**
 * Mark messages read, optimistically. Called when a conversation is opened in
 * the reader; only inbound rows still unread are sent, so re-opening a thread
 * costs nothing.
 */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (msgs: Message[]) => {
      const ids = msgs.map((m) => m.id);
      if (ids.length === 0) return;
      if (!supabase) {
        const d = loadDemo();
        d.read = [...new Set([...d.read, ...ids])];
        saveDemo(d);
        return;
      }
      const { error } = await supabase.from("messages").update({ is_read: true }).in("id", ids);
      if (error) throw error;
    },
    onMutate: async (msgs: Message[]) => {
      await qc.cancelQueries({ queryKey: UNREAD_COUNT_KEY });
      const meta = qc.getQueryData<MessageMeta>(MESSAGE_META_KEY);
      const drop = msgs.filter((m) => countsAsUnread(m, meta?.byId[m.id]?.is_read ?? false)).length;
      patchMeta(qc, (byId) => {
        for (const m of msgs) byId[m.id] = { label_ids: byId[m.id]?.label_ids ?? [], is_read: true };
      });
      qc.setQueryData<number>(UNREAD_COUNT_KEY, (n) => (typeof n === "number" ? Math.max(0, n - drop) : n));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      qc.invalidateQueries({ queryKey: MESSAGE_META_KEY });
    },
  });
}

// ── Labels ───────────────────────────────────────────────────────────────
export function useMailLabels() {
  return useQuery<MailLabel[]>({
    queryKey: MAIL_LABELS_KEY,
    queryFn: async () => {
      if (!supabase) return [...loadDemo().labels].sort((a, b) => a.name.localeCompare(b.name));
      const { data, error } = await supabase
        .from("mail_labels")
        .select("id,name,color,created_at")
        .order("name", { ascending: true });
      // Before 0091 the table is missing; an empty list hides the feature.
      if (error) return [];
      return (data ?? []) as MailLabel[];
    },
    retry: false,
  });
}

/** Postgres' unique violation, said in words a person can act on. */
const friendly = (e: { code?: string; message?: string }) =>
  e.code === "23505" ? new Error("You already have a label with that name.") : new Error(e.message || "Could not save the label.");

export function useMailLabelMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: MAIL_LABELS_KEY });

  const create = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: MailLabelColor }): Promise<MailLabel> => {
      const clean = name.trim().slice(0, 40);
      if (!clean) throw new Error("Give the label a name.");
      if (!supabase) {
        const d = loadDemo();
        if (d.labels.some((l) => l.name.trim().toLowerCase() === clean.toLowerCase())) throw new Error("You already have a label with that name.");
        const label: MailLabel = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: clean, color, created_at: new Date().toISOString() };
        d.labels.push(label);
        saveDemo(d);
        return label;
      }
      const { data, error } = await supabase.from("mail_labels").insert({ name: clean, color }).select("id,name,color,created_at").single();
      if (error) throw friendly(error);
      return data as MailLabel;
    },
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name?: string; color?: MailLabelColor }) => {
      const patch: Partial<MailLabel> = {};
      if (name !== undefined) {
        const clean = name.trim().slice(0, 40);
        if (!clean) throw new Error("Give the label a name.");
        patch.name = clean;
      }
      if (color) patch.color = color;
      if (!supabase) {
        const d = loadDemo();
        if (patch.name && d.labels.some((l) => l.id !== id && l.name.trim().toLowerCase() === patch.name!.toLowerCase())) {
          throw new Error("You already have a label with that name.");
        }
        d.labels = d.labels.map((l) => (l.id === id ? { ...l, ...patch } : l));
        saveDemo(d);
        return;
      }
      const { error } = await supabase.from("mail_labels").update(patch).eq("id", id);
      if (error) throw friendly(error);
    },
    onSettled: refresh,
  });

  /* The database trigger takes a deleted label off every message (0091), so
     only the local cache needs the same treatment here. */
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) {
        const d = loadDemo();
        d.labels = d.labels.filter((l) => l.id !== id);
        for (const k of Object.keys(d.tags)) d.tags[k] = d.tags[k].filter((x) => x !== id);
        saveDemo(d);
        return;
      }
      const { error } = await supabase.from("mail_labels").delete().eq("id", id);
      if (error) throw friendly(error);
    },
    onMutate: (id: string) => {
      qc.setQueryData<MailLabel[]>(MAIL_LABELS_KEY, (prev) => prev?.filter((l) => l.id !== id));
      patchMeta(qc, (byId) => {
        for (const k of Object.keys(byId)) {
          if (byId[k].label_ids.includes(id)) byId[k] = { ...byId[k], label_ids: byId[k].label_ids.filter((x) => x !== id) };
        }
      });
    },
    onSettled: () => { refresh(); qc.invalidateQueries({ queryKey: MESSAGE_META_KEY }); },
  });

  /* Adds or removes ONE label on a set of messages (a whole conversation),
     through set_message_label so two people labelling a shared Slack message
     at once cannot overwrite each other. */
  const setOnMessages = useMutation({
    mutationFn: async ({ messageIds, labelId, on }: { messageIds: string[]; labelId: string; on: boolean }) => {
      if (messageIds.length === 0) return;
      if (!supabase) {
        const d = loadDemo();
        for (const id of messageIds) {
          const cur = (d.tags[id] ?? []).filter((x) => x !== labelId);
          d.tags[id] = on ? [...cur, labelId] : cur;
        }
        saveDemo(d);
        return;
      }
      const { error } = await supabase.rpc("set_message_label", { p_message_ids: messageIds, p_label_id: labelId, p_on: on });
      if (error) throw new Error(error.message || "Could not change the label.");
    },
    onMutate: ({ messageIds, labelId, on }) => {
      patchMeta(qc, (byId) => {
        for (const id of messageIds) {
          const cur = (byId[id]?.label_ids ?? []).filter((x) => x !== labelId);
          byId[id] = { is_read: byId[id]?.is_read ?? false, label_ids: on ? [...cur, labelId] : cur };
        }
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MESSAGE_META_KEY }),
  });

  return { create, update, remove, setOnMessages };
}

// ── Label filter preference ──────────────────────────────────────────────
/**
 * The inbox's "Label:" filter, remembered per person on this device like any
 * other view preference. "" means any label. Storage can throw (private
 * window, blocked site data), so every access is guarded.
 */
export function useLabelFilter(userId: string | null | undefined) {
  const key = `madeea-inbox-label:${userId ?? "anon"}`;
  const read = () => {
    try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
  };
  const [value, setValue] = useState<string>(read);
  // A different person signing in on the same browser gets their own choice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setValue(read()); }, [key]);
  const set = (v: string) => {
    setValue(v);
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* not remembered, still applied */ }
  };
  return [value, set] as const;
}
