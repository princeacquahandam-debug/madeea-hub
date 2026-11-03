import { useEffect, useState } from "react";
import { CalendarDays, Clock, FileText, Inbox, Play, RotateCcw, UserRound } from "lucide-react";
import { SIM_BRIEF, SIM_CALENDAR, SIM_EMAILS, SIM_FILES, SIMULATION_MINUTES } from "@/data/academySimulation";
import { cn } from "@/lib/utils";

/**
 * The final client simulation's materials (Module 10). Before Start: the
 * brief. After Start: a 90-minute clock, and an inbox that fills up as it runs,
 * so the learner has to re-prioritise when new requests land.
 *
 * The start time is kept in this browser only. It is a practice clock, not an
 * exam timer: the trainer judges the work handed in, and the submission time is
 * on record if timing matters.
 */
const key = (lessonId: string) => `madeea-sim-start:${lessonId}`;
const readStart = (lessonId: string): number | null => {
  try { const v = Number(localStorage.getItem(key(lessonId))); return v > 0 ? v : null; } catch { return null; }
};

type Tab = "inbox" | "calendar" | "files" | "brief";

export function SimulationPack({ lessonId }: { lessonId: string }) {
  const [startedAt, setStartedAt] = useState<number | null>(() => readStart(lessonId));
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("inbox");
  const [openId, setOpenId] = useState<number | null>(null);
  const [read, setRead] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  function start() {
    const t = Date.now();
    try { localStorage.setItem(key(lessonId), String(t)); } catch { /* the clock still runs for this visit */ }
    setStartedAt(t); setNow(t); setTab("inbox"); setRead(new Set()); setOpenId(null);
  }
  function startOver() {
    try { localStorage.removeItem(key(lessonId)); } catch { /* nothing stored */ }
    setStartedAt(null);
  }

  if (!startedAt) {
    return (
      <div className="card mb-6 p-5">
        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-accent">The scenario</p>
        <Brief />
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <button className="btn-primary" onClick={start}><Play size={15} /> Start the simulation ({SIMULATION_MINUTES} minutes)</button>
          <span className="text-[13px] text-faint">The inbox, calendar and files open when you start. New emails arrive during the first hour.</span>
        </div>
      </div>
    );
  }

  const elapsed = Math.max(0, (now - startedAt) / 60_000);
  const left = Math.max(0, SIMULATION_MINUTES - elapsed);
  const over = left <= 0;
  const arrived = SIM_EMAILS.filter((e) => over || e.at <= elapsed).sort((a, b) => b.at - a.at);
  const unread = arrived.filter((e) => !read.has(e.id)).length;
  const clock = (mins: number) => `${Math.floor(mins)}:${String(Math.floor((mins % 1) * 60)).padStart(2, "0")}`;

  const tabs: { id: Tab; label: string; icon: typeof Inbox; count?: number }[] = [
    { id: "inbox", label: "Inbox", icon: Inbox, count: unread },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "files", label: "Files", icon: FileText },
    { id: "brief", label: "Brief", icon: UserRound },
  ];

  return (
    <div className="card mb-6 overflow-hidden">
      <div className={cn("flex flex-wrap items-center gap-3 border-b border-border px-5 py-3", over && "bg-amber-500/[0.06]")}>
        <Clock size={17} className={over ? "text-amber-400" : "text-accent"} />
        <p className="font-bold tabular-nums" aria-live="polite">
          {over ? "Time's up. Hand in your work below." : `${clock(left)} left`}
        </p>
        <span className="text-[12.5px] text-faint">{arrived.length} of {SIM_EMAILS.length} emails in</span>
        <div className="ml-auto h-1.5 w-full overflow-hidden rounded-full bg-white/10 sm:w-40">
          <div className={cn("h-full rounded-full", over ? "bg-amber-400" : "bg-accent")} style={{ width: `${Math.min(100, (elapsed / SIMULATION_MINUTES) * 100)}%` }} />
        </div>
        {over && <button className="btn-ghost h-8 border border-border py-0 text-[13px]" onClick={startOver}><RotateCcw size={13} /> Start over</button>}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
              tab === t.id ? "bg-[color:var(--nav-active-bg)] text-accent" : "text-muted hover:text-fg")}
          >
            <t.icon size={14} /> {t.label}
            {!!t.count && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="max-h-[560px] overflow-y-auto">
        {tab === "inbox" && (
          <ul className="divide-y divide-border">
            {arrived.map((e) => {
              const isOpen = openId === e.id;
              const isRead = read.has(e.id);
              return (
                <li key={e.id}>
                  <button
                    className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-white/[0.03]"
                    aria-expanded={isOpen}
                    onClick={() => { setOpenId(isOpen ? null : e.id); setRead((r) => new Set(r).add(e.id)); }}
                  >
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isRead ? "bg-transparent" : "bg-accent")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[14px]", !isRead && "font-bold")}>{e.subject}</span>
                      <span className="block truncate text-[12.5px] text-faint">#{e.id} · {e.from}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-faint">{e.at === 0 ? "at start" : `+${e.at} min`}</span>
                  </button>
                  {isOpen && <p className="whitespace-pre-line px-10 pb-4 text-[14px] leading-relaxed text-muted">{e.body}</p>}
                </li>
              );
            })}
          </ul>
        )}

        {tab === "calendar" && (
          <ul className="divide-y divide-border">
            {SIM_CALENDAR.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5 text-[14px]">
                <span className="w-24 shrink-0 font-semibold">{c.day}</span>
                <span className="w-36 shrink-0 tabular-nums text-muted">{c.time}</span>
                <span className="min-w-0 flex-1">{c.title}{c.note && <span className="text-faint"> · {c.note}</span>}</span>
              </li>
            ))}
          </ul>
        )}

        {tab === "files" && (
          <div className="space-y-4 p-5">
            {SIM_FILES.map((f) => (
              <details key={f.name} className="rounded-xl border border-border">
                <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold">{f.name}</summary>
                <p className="whitespace-pre-line border-t border-border px-4 py-3 text-[13.5px] leading-relaxed text-muted">{f.body}</p>
              </details>
            ))}
          </div>
        )}

        {tab === "brief" && <div className="p-5"><Brief /></div>}
      </div>
    </div>
  );
}

function Brief() {
  return (
    <div className="space-y-4 text-[14px] leading-relaxed">
      <p><b>You support:</b> {SIM_BRIEF.executive}</p>
      <p>{SIM_BRIEF.today}</p>
      <div>
        <p className="mb-1 font-semibold">How Daniel likes things done</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">{SIM_BRIEF.preferences.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
      <div>
        <p className="mb-1 font-semibold">Who's who</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">{SIM_BRIEF.people.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
      <div>
        <p className="mb-1 font-semibold">What to hand in</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">{SIM_BRIEF.deliver.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
      <p className="text-[13px] text-faint">Use AI where it helps, and check what it gives you. Everything here is fictional; the one research task is about a real topic.</p>
    </div>
  );
}
