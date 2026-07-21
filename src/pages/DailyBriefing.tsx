import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, CalendarClock, Mail, Target, Brain, Coffee, Info } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { useClients, useMeetings, useMemories, useMessages, useTasks } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { useAuth } from "@/hooks/useAuth";
import { generate } from "@/lib/ai";
import { briefingPromptInputs, buildBriefing, isQuietDay } from "@/lib/briefing";

/** When the last briefing was opened — drives the "new since" section. */
const LAST_SEEN_KEY = "madeea-briefing-last-seen";

export default function DailyBriefing() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: meetings = [] } = useMeetings();
  const { data: clients = [] } = useClients();
  const { data: memories = [] } = useMemories();
  const cfg = useSlaSettings((s) => s.config);

  // Read once on mount, then stamp — so the "new since" line refers to the
  // PREVIOUS visit, not this one.
  const [lastSeen] = useState<string | null>(() => localStorage.getItem(LAST_SEEN_KEY));
  useEffect(() => {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
  }, []);

  const [prose, setProse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const b = useMemo(
    () => buildBriefing({ tasks, messages, meetings, clients, memories, cfg, lastSeenAt: lastSeen }),
    [tasks, messages, meetings, clients, memories, cfg, lastSeen],
  );

  async function write() {
    setBusy(true);
    setError("");
    setProse("");
    try {
      setProse(await generate({ tool: "briefing", format: "Daily briefing", inputs: briefingPromptInputs(b) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the briefing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={`${b.greeting}, ${user?.name?.split(" ")[0] ?? "there"}.`}
        subtitle={b.date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        action={
          <button className="btn-primary" onClick={write} disabled={busy}>
            <Sparkles size={15} />
            {busy ? "Writing…" : "Read it to me"}
          </button>
        }
      />

      {b.newSinceLast.length > 0 && (
        <div className="card mb-5 p-4">
          <p className="eyebrow mb-1">Since your last briefing</p>
          <p className="text-sm text-muted">{b.newSinceLast.join(" · ")}</p>
        </div>
      )}

      {error && <div className="card mb-5 border-red-500/40 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>}

      {prose && (
        <section className="card mb-5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={15} className="text-accent-soft" />
            <h2 className="font-semibold">Your briefing</h2>
            <button className="ml-auto text-xs text-faint hover:text-zinc-100" onClick={() => setProse("")}>
              Dismiss
            </button>
          </div>
          <OutputViewer output={prose} title="Daily briefing" />
        </section>
      )}

      {isQuietDay(b) && (
        <div className="card mb-5 flex items-center gap-3 p-5">
          <Coffee size={22} className="shrink-0 text-emerald-400" />
          <div>
            <p className="font-medium">Genuinely a quiet one</p>
            <p className="text-sm text-faint">
              No meetings, nothing ranked, nothing waiting. That's the data, not an empty page.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section icon={CalendarClock} title="Today's meetings" count={b.meetingsToday.length}>
          {b.meetingsToday.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
              <span className="w-12 shrink-0 text-xs font-medium text-muted">{m.time}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.title}</p>
                <p className="truncate text-xs text-faint">{m.with}</p>
              </div>
              {m.minutesAway > 0 && m.minutesAway < 120 && (
                <Badge tone="high">in {m.minutesAway}m</Badge>
              )}
            </div>
          ))}
        </Section>

        <Section icon={Target} title="What to do first" count={b.focus.length} onAll={() => nav("/focus")}>
          {b.focus.map((f, i) => (
            <button
              key={f.id}
              className="flex w-full items-center gap-3 rounded-lg bg-surface-2 p-3 text-left hover:bg-surface-2/70"
              onClick={() => nav(f.path)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-soft">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.title}</p>
                <p className="truncate text-xs text-faint">{f.reasons[0]?.label}</p>
              </div>
            </button>
          ))}
        </Section>

        <Section icon={Mail} title="Waiting on you" count={b.waiting.length} onAll={() => nav("/communication")}>
          {b.waiting.map((w) => (
            <div
              key={w.id}
              className={`flex items-center gap-3 rounded-lg p-3 ${w.breached ? "border border-red-500/40 bg-red-500/5" : "bg-surface-2"}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{w.subject}</p>
                <p className="truncate text-xs text-faint">{w.who}</p>
              </div>
              <Badge tone={w.breached ? "urgent" : "normal"}>{w.waited}</Badge>
            </div>
          ))}
        </Section>

        <Section icon={Brain} title="Standing commitments" count={b.commitments.length} onAll={() => nav("/memory")}>
          {b.commitments.map((c) => (
            <div key={c.id} className="rounded-lg bg-surface-2 p-3">
              <p className="text-sm">{c.body}</p>
              {c.source && <p className="mt-0.5 text-xs italic text-faint">{c.source}</p>}
            </div>
          ))}
        </Section>
      </div>

      {b.dueToday.length > 0 && (
        <section className="card mt-5 p-5">
          <h2 className="mb-3 font-semibold">Owed before the day is out</h2>
          <div className="space-y-2">
            {b.dueToday.map((h) => (
              <div key={h.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.title}</p>
                  <p className="truncate text-xs text-muted">{h.reason}</p>
                </div>
                <span className="shrink-0 text-xs text-faint">{h.dueLabel}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {b.coverage.length > 0 && (
        <div className="card mt-5 border-amber-500/30 bg-amber-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <Info size={14} className="text-amber-400" />
            <p className="text-sm font-medium text-amber-200">Why some sections are empty</p>
          </div>
          <ul className="space-y-1 text-xs text-amber-100/80">
            {b.coverage.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  onAll,
  children,
}: {
  icon: typeof Mail;
  title: string;
  count: number;
  onAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-accent-soft" />
        <h2 className="font-semibold">{title}</h2>
        {onAll && (
          <button className="ml-auto text-xs text-accent-soft hover:underline" onClick={onAll}>
            View all
          </button>
        )}
      </div>
      <div className="space-y-2">
        {count > 0 ? children : <p className="py-4 text-center text-xs text-faint">Nothing here.</p>}
      </div>
    </section>
  );
}
