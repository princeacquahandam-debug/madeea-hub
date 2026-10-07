import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, CalendarDays, CheckCircle2, Info, KanbanSquare, MessageSquare, Moon, Search,
  ShieldCheck, StickyNote, Sun, AlertCircle, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/store/theme";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import { cn } from "@/lib/utils";

/**
 * Search, page guide, theme and notifications, for the client portal header.
 *
 * ClientShell's note says these agency tools were left out on purpose. These
 * are not those: each one reads only the client-safe views this account can
 * already see, so nothing here can surface another client or an EA's other
 * work. They sit in the header because the 6 Oct review asked for the portal
 * to feel like the same product, and these four are what a person reaches for
 * in any header.
 *
 * EVERY PANEL IS PORTALLED. The header clips overflow and carries a
 * backdrop-filter; useAnchoredPanel explains why only <body> works.
 */

type Kind = "client_ea" | "escalation";

interface TaskRow {
  id: string;
  title: string;
  status: string;
  blocked: boolean | null;
  client_visible_blocker: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

interface NoteRow { id: string; title: string; body: string; author_is_client: boolean; created_at: string; updated_at: string }
interface EventRow { id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; location: string | null; event_timezone: string | null; hangout_link: string | null }

const BTN =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text";
const PANEL = cn(ANCHORED_PANEL_CLASS, "card p-3 shadow-xl");

/* The same queries, under the same keys, as Overview, Notes and Calendar. A
   second shape under a shared key would hand one pane the other's rows. */
async function fetchTasks() {
  const { data, error } = await supabase!.from("client_tasks").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TaskRow[];
}

async function fetchNotes() {
  const { data, error } = await supabase!
    .from("client_notes")
    .select("id, title, body, author_is_client, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as NoteRow[];
}

async function fetchCalendar() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const { data, error } = await supabase!
    .from("client_calendar")
    .select("id, title, starts_at, ends_at, all_day, location, event_timezone, hangout_link")
    .gte("starts_at", from.toISOString())
    .order("starts_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export function ClientHeaderTools({ onNavigate }: { onNavigate: (tab: string) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <SearchTool onNavigate={onNavigate} />
      <GuideTool />
      <ThemeTool />
      <BellTool onNavigate={onNavigate} />
    </div>
  );
}

/* ───────────────────────── Search ───────────────────────── */

function SearchTool({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // Nothing is fetched until the panel opens; a closed search costs nothing.
  const tasks = useQuery({ queryKey: ["client-portal", "tasks"], queryFn: fetchTasks, enabled: open });
  const notes = useQuery({ queryKey: ["client-portal", "notes"], queryFn: fetchNotes, enabled: open });
  const events = useQuery({ queryKey: ["client-portal", "calendar"], queryFn: fetchCalendar, enabled: open });

  useEffect(() => {
    if (open) input.current?.focus();
    else setQ("");
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle);
    return [
      { label: "Tasks", tab: "tasks", icon: KanbanSquare,
        items: (tasks.data ?? []).filter((t) => has(t.title)).slice(0, 5).map((t) => ({ id: t.id, text: t.title })) },
      { label: "Notes", tab: "notes", icon: StickyNote,
        items: (notes.data ?? []).filter((n) => has(n.title) || has(n.body)).slice(0, 5)
          .map((n) => ({ id: n.id, text: n.title || n.body.slice(0, 80) })) },
      { label: "Meetings", tab: "calendar", icon: CalendarDays,
        items: (events.data ?? []).filter((e) => has(e.title)).slice(0, 5).map((e) => ({ id: e.id, text: e.title })) },
    ].filter((g) => g.items.length > 0);
  }, [q, tasks.data, notes.data, events.data]);

  const go = (tab: string) => { onNavigate(tab); setOpen(false); };
  const loading = tasks.isLoading || notes.isLoading || events.isLoading;

  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label="Search your account" title="Search your account" className={BTN}>
        <Search size={17} />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="dialog" aria-label="Search your account" style={{ top: pos.top, right: pos.right }} className={PANEL}>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
            <Search size={15} className="shrink-0 text-faint" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks, notes and meetings"
              aria-label="Search tasks, notes and meetings"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
            />
          </div>
          <div className="mt-2">
            {!results ? (
              <p className="px-1 py-2 text-xs text-faint">Type to search your tasks, shared notes and upcoming meetings.</p>
            ) : loading ? (
              <p className="px-1 py-2 text-xs text-faint">Loading…</p>
            ) : results.length === 0 ? (
              <p className="px-1 py-2 text-xs text-faint">Nothing matches "{q.trim()}".</p>
            ) : (
              results.map((g) => (
                <div key={g.label} className="mt-2 first:mt-0">
                  <p className="eyebrow px-1 pb-1">{g.label}</p>
                  {g.items.map((it) => (
                    <button key={it.id} onClick={() => go(g.tab)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--chip-bg)]">
                      <g.icon size={14} className="shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{it.text}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ───────────────────────── Guide ───────────────────────── */

/* One guide for the whole portal. Per-tab guides would mostly repeat the
   subtitle already under each page title. */
const GUIDE = [
  "Overview shows where your account stands: hours this week, open tasks and anything waiting on you.",
  "Tasks shows every task by status, from To do through to Done. You can request a new one at any time.",
  "Daily reports sum up each working day: what got done, what is blocked, and the plan for tomorrow.",
  "Messages has two channels. Your assistant is private between you and your EA. Agency leadership is for anything you would rather raise above them.",
  "Delegate helps you hand a piece of work over properly, with Madeline checking it is clear first.",
];

function GuideTool() {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label="How the portal works" title="How the portal works" className={BTN}>
        <Info size={17} />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="dialog" aria-label="How the portal works" style={{ top: pos.top, right: pos.right }} className={PANEL}>
          <div className="mb-2 flex items-center gap-2">
            <Info size={15} className="shrink-0 text-accent-soft" />
            <p className="flex-1 text-sm font-bold">How the portal works</p>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-faint hover:text-text"><X size={15} /></button>
          </div>
          <ul className="space-y-1.5 text-sm text-muted">
            {GUIDE.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 text-accent-soft">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ───────────────────────── Theme ───────────────────────── */

function ThemeTool() {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button onClick={toggle} aria-label={label} title={label} className={BTN}>
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

/* ───────────────────────── Notifications ───────────────────────── */

interface Notif {
  id: string;
  at: string;
  text: string;
  tab: string;
  icon: typeof Bell;
  tone?: string;
}

const WEEK_MS = 7 * 86_400_000;
const seenKey = (uid: string) => `madeea-client-notif-seen-${uid}`;

function readSeen(uid: string | undefined): number {
  if (!uid) return 0;
  try { return Number(localStorage.getItem(seenKey(uid))) || 0; } catch { return 0; }
}

function BellTool({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { user } = useAuth();
  const uid = user?.id;
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const [seen, setSeen] = useState(() => readSeen(uid));
  useEffect(() => { setSeen(readSeen(uid)); }, [uid]);

  /* The badge needs the count before the panel opens, so tasks load up front.
     They share Overview's key, so on the default tab this is a cache hit. */
  const tasks = useQuery({ queryKey: ["client-portal", "tasks"], queryFn: fetchTasks, refetchInterval: 60_000 });

  /* Both channels' recent agency messages. Its own key, because the portal's
     per-conversation key is the full thread and this is a week's slice. A
     viewer has no conversations, which simply means no message items. */
  const msgs = useQuery({
    queryKey: ["client-portal", "notif-messages", uid],
    enabled: !!uid,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data: convs, error: cErr } = await supabase!.from("conversations").select("id, kind");
      if (cErr) throw cErr;
      const kinds = new Map((convs ?? []).map((c: { id: string; kind: Kind }) => [c.id, c.kind]));
      if (kinds.size === 0) return [];
      const { data, error } = await supabase!
        .from("conversation_messages")
        .select("id, conversation_id, sent_at, sender_id")
        .in("conversation_id", [...kinds.keys()])
        .gte("sent_at", new Date(Date.now() - WEEK_MS).toISOString())
        .order("sent_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? [])
        // Anything not sent by me came from the agency side.
        .filter((m: { sender_id: string | null }) => m.sender_id !== uid)
        .map((m: { id: string; conversation_id: string; sent_at: string }) => ({
          id: m.id, at: m.sent_at, kind: kinds.get(m.conversation_id) as Kind,
        }));
    },
  });

  const items = useMemo<Notif[]>(() => {
    const since = Date.now() - WEEK_MS;
    const recent = (iso: string | null | undefined): iso is string => !!iso && new Date(iso).getTime() >= since;
    const out: Notif[] = [];
    for (const t of tasks.data ?? []) {
      if (t.status === "done" && recent(t.completed_at)) {
        out.push({ id: `done-${t.id}`, at: t.completed_at, text: `Done: ${t.title}`, tab: "tasks", icon: CheckCircle2 });
      }
      /* updated_at stands in for "when it started waiting": there is no
         separate timestamp for the blocker, and the row changes when it is set. */
      const waitingAt = t.updated_at ?? t.created_at;
      if (t.status !== "done" && t.blocked && t.client_visible_blocker && recent(waitingAt)) {
        out.push({ id: `wait-${t.id}`, at: waitingAt, text: `Waiting on you: ${t.title}`, tab: "tasks",
          icon: AlertCircle, tone: "text-amber-400" });
      }
    }
    for (const m of msgs.data ?? []) {
      out.push({
        id: `msg-${m.id}`, at: m.at, tab: m.kind,
        text: m.kind === "escalation" ? "New message from agency leadership" : "New message from your assistant",
        icon: m.kind === "escalation" ? ShieldCheck : MessageSquare,
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
  }, [tasks.data, msgs.data]);

  const unread = items.filter((n) => new Date(n.at).getTime() > seen).length;

  function markAll() {
    const now = Date.now();
    setSeen(now);
    if (!uid) return;
    try { localStorage.setItem(seenKey(uid), String(now)); } catch { /* private mode: count resets next visit */ }
  }

  // Fail quiet: a bell that errors is worse than no bell.
  if (tasks.isError) return null;

  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        title="Notifications" className={cn(BTN, "relative")}>
        <Bell size={17} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
            style={{ background: "var(--c-accent)" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="dialog" aria-label="Notifications" style={{ top: pos.top, right: pos.right }} className={PANEL}>
          <div className="mb-2 flex items-center gap-2 px-1">
            <p className="flex-1 text-sm font-bold">Notifications</p>
            {unread > 0 ? (
              <button onClick={markAll} className="text-xs text-accent-soft hover:underline">Mark all as read</button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="px-1 py-3 text-sm text-faint">You're all caught up.</p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((n) => {
                const fresh = new Date(n.at).getTime() > seen;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => { onNavigate(n.tab); setOpen(false); }}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--chip-bg)]",
                        fresh && "bg-surface-2",
                      )}
                    >
                      <n.icon size={15} className={cn("mt-0.5 shrink-0", n.tone ?? "text-accent-soft")} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block break-words text-sm", fresh ? "font-medium" : "text-muted")}>{n.text}</span>
                        <span className="block text-[11px] text-faint">{when(n.at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
