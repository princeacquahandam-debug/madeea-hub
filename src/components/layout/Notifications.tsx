import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, AlertCircle, CheckSquare, CalendarClock, Clock, Plus, X, BellOff, MailQuestion, Clock3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMessages, useTasks, useReminders, useReminderMutations, useSnoozeMutations } from "@/data/hooks";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useFollowUpSettings } from "@/store/followupSettings";

interface Notif {
  id: string; icon: typeof AlertCircle; title: string; desc: string; path: string;
  /** Present on follow-up nudges: lets you silence it without acting on it. */
  snooze?: { item_type: "message" | "task"; item_id: string };
}

const STORE = "madeea-notif-read";
const loadRead = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(STORE) || "[]")); } catch { return new Set(); }
};

const WHENS: { label: string; ms: number }[] = [
  { label: "In 1 hour", ms: 3600e3 },
  { label: "Later today", ms: 4 * 3600e3 },
  { label: "Tomorrow", ms: 24 * 3600e3 },
  { label: "In 3 days", ms: 3 * 864e5 },
  { label: "Next week", ms: 7 * 864e5 },
];

export function Notifications() {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(loadRead);
  const { data: messages = [] } = useMessages();
  const { data: tasks = [] } = useTasks();
  const { data: reminders = [] } = useReminders();
  const { create, dismiss } = useReminderMutations();
  const { flags } = useFollowUps();
  const { snooze } = useSnoozeMutations();
  const snoozeDays = useFollowUpSettings((s) => s.config.snoozeDays);

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [whenMs, setWhenMs] = useState(WHENS[3].ms);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const now = Date.now();
  const todayUtc = new Date().toISOString().slice(0, 10);
  const soonUtc = new Date(now + 3 * 864e5).toISOString().slice(0, 10);

  const items = useMemo<Notif[]>(() => {
    const out: Notif[] = [];
    // Follow-ups lead: a thread nobody replied to is invisible everywhere else.
    for (const f of flags) {
      out.push({
        id: f.id,
        icon: f.kind === "dead_thread" ? MailQuestion : Clock3,
        title: f.kind === "dead_thread" ? "No reply" : "Stale task",
        desc: `${f.title} · ${f.reason}`,
        path: f.path,
        snooze: { item_type: f.itemType, item_id: f.itemId },
      });
    }
    for (const m of messages.filter((x) => x.category === "urgent")) {
      out.push({ id: `msg-${m.id}`, icon: AlertCircle, title: "Urgent message", desc: `${m.sender_name} · ${m.subject}`, path: "/communication" });
    }
    for (const t of tasks.filter((x) => x.status !== "done")) {
      if (t.priority === "urgent") {
        out.push({ id: `task-${t.id}`, icon: CheckSquare, title: "Urgent task", desc: t.title, path: "/tasks" });
      } else if (t.due_at) {
        const d = t.due_at.slice(0, 10);
        if (d < todayUtc) out.push({ id: `due-${t.id}`, icon: CalendarClock, title: "Overdue", desc: t.title, path: "/tasks" });
        else if (d === todayUtc) out.push({ id: `due-${t.id}`, icon: CalendarClock, title: "Due today", desc: t.title, path: "/tasks" });
        else if (d <= soonUtc) out.push({ id: `due-${t.id}`, icon: CalendarClock, title: "Due soon", desc: t.title, path: "/tasks" });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, tasks, flags]);

  const dueReminders = reminders.filter((r) => new Date(r.remind_at).getTime() <= now);
  const upcoming = reminders.filter((r) => new Date(r.remind_at).getTime() > now);
  const unread = items.filter((i) => !read.has(i.id)).length + dueReminders.length;

  function persist(next: Set<string>) { setRead(next); localStorage.setItem(STORE, JSON.stringify([...next])); }
  function pick(n: Notif) { persist(new Set(read).add(n.id)); nav(n.path); setOpen(false); }
  function markAll() { persist(new Set(items.map((i) => i.id))); }
  function addReminder() {
    if (!label.trim()) return;
    create.mutate({ label: label.trim(), remind_at: new Date(now + whenMs).toISOString() });
    setLabel(""); setAdding(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost relative px-2" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{unread}</span>
        )}
      </button>

      {open && (
        <div className="card absolute right-0 z-50 mt-2 max-h-[28rem] w-80 overflow-y-auto p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-sm font-semibold">Notifications</p>
            {items.some((i) => !read.has(i.id)) && (
              <button className="text-xs text-accent-soft hover:underline" onClick={markAll}>Mark all read</button>
            )}
          </div>

          {items.length === 0 && dueReminders.length === 0 ? (
            <p className="px-2 py-5 text-center text-sm text-faint">You're all caught up.</p>
          ) : (
            <>
              {dueReminders.map((r) => (
                <div key={r.id} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-surface-2">
                  <Clock size={15} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Reminder</span>
                    <span className="block truncate text-xs text-faint">{r.label}</span>
                  </span>
                  <button className="text-faint hover:text-zinc-100" onClick={() => dismiss.mutate(r.id)} aria-label="Dismiss"><X size={14} /></button>
                </div>
              ))}
              {items.map((n) => {
                const isUnread = !read.has(n.id);
                return (
                  <div key={n.id} className={`group flex items-start gap-2 rounded-md px-2 py-2 hover:bg-surface-2 ${isUnread ? "" : "opacity-60"}`}>
                    <button onClick={() => pick(n)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                      <n.icon size={15} className={`mt-0.5 shrink-0 ${isUnread ? (n.snooze ? "text-amber-400" : "text-accent") : "text-faint"}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{n.title}</span>
                        <span className="block truncate text-xs text-faint">{n.desc}</span>
                      </span>
                    </button>
                    {n.snooze && (
                      <button
                        className="mt-0.5 shrink-0 text-faint hover:text-amber-400"
                        title={`Snooze ${snoozeDays} days`}
                        aria-label={`Snooze ${n.title}`}
                        onClick={() => snooze.mutate({ ...n.snooze!, days: snoozeDays })}
                      >
                        <BellOff size={13} />
                      </button>
                    )}
                    {isUnread && !n.snooze && <span className="ml-auto mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  </div>
                );
              })}
            </>
          )}

          {upcoming.length > 0 && (
            <div className="mt-1 border-t border-border pt-1">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Upcoming</p>
              {upcoming.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <Clock size={12} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-muted">{r.label}</span>
                  <span className="shrink-0 text-faint">{new Date(r.remind_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <button className="text-faint hover:text-red-400" onClick={() => dismiss.mutate(r.id)} aria-label="Remove"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-1 border-t border-border p-1">
            {adding ? (
              <div className="space-y-2 p-1">
                <input className="input py-1.5 text-sm" autoFocus placeholder="Remind me to…" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addReminder()} />
                <div className="flex gap-2">
                  <select className="input py-1.5 text-xs" value={whenMs} onChange={(e) => setWhenMs(Number(e.target.value))}>
                    {WHENS.map((w) => <option key={w.label} value={w.ms}>{w.label}</option>)}
                  </select>
                  <button className="btn-primary py-1.5 text-xs" onClick={addReminder} disabled={!label.trim()}>Add</button>
                </div>
              </div>
            ) : (
              <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-accent-soft hover:bg-surface-2" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add reminder
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
