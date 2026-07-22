import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Play, Square, Ban, ArrowRight, CheckCircle2, Info, Compass } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { useClients, useMeetings, useMemories, useMessages, useTasks } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { generate } from "@/lib/ai";
import { computeGoalDrift } from "@/lib/goalDrift";
import {
  FOCUS_DURATIONS,
  focusPromptInputs,
  formatClock,
  MINUTE_MS,
  nextUp,
  rankFocus,
  type FocusItem,
} from "@/lib/focus";

export default function Focus() {
  const nav = useNavigate();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: clients = [] } = useClients();
  const { data: meetings = [] } = useMeetings();
  const { data: memories = [] } = useMemories();
  const cfg = useSlaSettings((s) => s.config);

  const [showWhy, setShowWhy] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ranked = useMemo(() => rankFocus({ tasks, messages, clients, cfg }), [tasks, messages, clients, cfg]);
  const drift = useMemo(() => computeGoalDrift({ memories, meetings }, 7), [memories, meetings]);
  const top = useMemo(() => nextUp(ranked, 3), [ranked]);
  const blocked = ranked.filter((i) => i.blockedBy);

  // ---- focus timer ----
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const tick = useRef<number | null>(null);

  useEffect(() => {
    if (endsAt === null) return;
    const update = () => {
      const left = endsAt - Date.now();
      setRemaining(left);
      if (left <= 0) setEndsAt(null);
    };
    update();
    tick.current = window.setInterval(update, 1000);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
    };
  }, [endsAt]);

  async function writePlan() {
    setBusy(true);
    setError("");
    setPlan("");
    try {
      const out = await generate({
        tool: "focus",
        format: "Plan the next hour",
        inputs: focusPromptInputs(ranked),
      });
      setPlan(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Focus Helper"
        subtitle="One ranked list across tasks and unanswered mail — with the reasoning shown, so you can disagree with it."
        action={
          <button className="btn-primary" onClick={writePlan} disabled={busy || !ranked.length}>
            <Sparkles size={15} />
            {busy ? "Planning…" : "Plan my next hour"}
          </button>
        }
      />

      {/* ---- the session ---- */}
      <section className="card mb-5 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="eyebrow">Focus session</p>
            {/* An idle "--:--" in the display serif reads as a stray squiggle rather
                than a clock, so the resting state is a word instead. */}
            {endsAt ? (
              <p className="display mt-1 text-4xl tabular-nums">{formatClock(remaining)}</p>
            ) : (
              <p className="mt-1 text-lg font-medium text-faint">Not running</p>
            )}
          </div>
          <div className="flex gap-2">
            {endsAt === null ? (
              FOCUS_DURATIONS.map((m) => (
                <button
                  key={m}
                  className="btn-ghost border border-border py-1.5 text-xs"
                  onClick={() => setEndsAt(Date.now() + m * MINUTE_MS)}
                  disabled={!top.length}
                >
                  <Play size={13} /> {m} min
                </button>
              ))
            ) : (
              <button className="btn-ghost border border-border py-1.5 text-xs" onClick={() => setEndsAt(null)}>
                <Square size={13} /> Stop
              </button>
            )}
          </div>
          {top[0] && (
            <div className="min-w-0 flex-1 rounded-lg bg-surface-2 p-3">
              <p className="eyebrow">Working on</p>
              <p className="truncate text-sm font-medium">{top[0].title}</p>
              <p className="truncate text-xs text-faint">{top[0].subtitle}</p>
            </div>
          )}
        </div>
      </section>

      {/* ---- goal drift: does the diary match what was said to matter? ---- */}
      <section className="card mb-5 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Compass size={16} className="text-accent-soft" />
          <h2 className="font-semibold">Goal drift</h2>
          <span className="ml-auto text-xs text-faint">last {drift.periodDays} days</span>
        </div>

        {drift.noGoals ? (
          <div className="rounded-lg bg-surface-2 p-4 text-sm">
            <p className="font-medium">No goals recorded yet</p>
            <p className="mt-1 text-xs text-faint">
              Add what the boss said matters this quarter in the{" "}
              <button className="text-accent-soft hover:underline" onClick={() => nav("/memory")}>
                Memory Helper
              </button>{" "}
              (kind: Goal), and this will check the diary against them.
            </p>
          </div>
        ) : (
          <>
            {drift.headline && (
              <p
                className={`mb-3 rounded-lg border p-3 text-sm ${
                  drift.unconnectedPct !== null && drift.unconnectedPct >= 50
                    ? "border-amber-500/40 bg-amber-500/5 text-amber-100"
                    : "border-border bg-surface-2 text-muted"
                }`}
              >
                {drift.headline}
              </p>
            )}

            <div className="space-y-2">
              {drift.goals.map((g) => (
                <div key={g.id} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{g.goal}</p>
                    <span className={`shrink-0 text-xs tabular-nums ${g.matched === 0 ? "text-red-400" : "text-muted"}`}>
                      {g.matched} of {drift.totalMeetings}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
                    <div
                      className={g.matched === 0 ? "h-full bg-red-500/60" : "h-full bg-accent"}
                      style={{ width: `${g.sharePct ?? 0}%` }}
                    />
                  </div>
                  {g.examples.length > 0 && (
                    <p className="mt-1 truncate text-[11px] text-faint">e.g. {g.examples.join(" · ")}</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <ul className="mt-3 space-y-0.5 text-[11px] leading-snug text-faint">
          {drift.caveats.map((c, i) => (
            <li key={i}>• {c}</li>
          ))}
        </ul>
      </section>

      {error && <div className="card mb-5 border-red-500/40 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>}

      {plan && (
        <section className="card mb-5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={15} className="text-accent-soft" />
            <h2 className="font-semibold">The plan</h2>
            <button className="ml-auto text-xs text-faint hover:text-zinc-100" onClick={() => setPlan("")}>
              Dismiss
            </button>
          </div>
          <OutputViewer output={plan} title="Focus plan" />
        </section>
      )}

      {ranked.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-14 text-center">
          <CheckCircle2 size={30} className="text-emerald-400" />
          <p className="font-medium">Nothing is pressing</p>
          <p className="max-w-md text-sm text-faint">
            Ranking is driven by due dates, priority and how long mail has been waiting. Work with
            none of those signals isn't ranked at all rather than given a made-up position.
          </p>
        </div>
      ) : (
        <>
          <section className="card mb-5 p-5">
            <h2 className="mb-3 font-semibold">Next up</h2>
            <div className="space-y-2">
              {top.map((item, i) => (
                <Row
                  key={item.id}
                  item={item}
                  rank={i + 1}
                  open={showWhy === item.id}
                  onToggle={() => setShowWhy(showWhy === item.id ? null : item.id)}
                  onOpen={() => nav(item.path)}
                />
              ))}
              {!top.length && (
                <p className="py-4 text-center text-xs text-faint">
                  Everything ranked is blocked — clear a blocker below.
                </p>
              )}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Everything else, in order</h2>
            <div className="space-y-2">
              {ranked.slice(top.length).map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  open={showWhy === item.id}
                  onToggle={() => setShowWhy(showWhy === item.id ? null : item.id)}
                  onOpen={() => nav(item.path)}
                />
              ))}
            </div>
            {blocked.length > 0 && (
              <p className="mt-3 text-[11px] leading-snug text-faint">
                {blocked.length} item{blocked.length === 1 ? " is" : "s are"} ranked down because
                {blocked.length === 1 ? " it's" : " they're"} blocked. They're kept visible rather than
                hidden — the blocker is often the thing worth clearing.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Row({
  item,
  rank,
  open,
  onToggle,
  onOpen,
}: {
  item: FocusItem;
  rank?: number;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className={`rounded-lg p-3 ${item.blockedBy ? "bg-surface-2/50" : "bg-surface-2"}`}>
      <div className="flex items-start gap-3">
        {rank && (
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-soft">
            {rank}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={item.kind === "email" ? "reply" : "normal"}>
              {item.kind === "email" ? "Email" : "Task"}
            </Badge>
            <p className="truncate text-sm font-medium">{item.title}</p>
            <span className="text-xs text-faint">· {item.subtitle}</span>
            {item.blockedBy && (
              <span className="pill bg-zinc-500/15 text-faint">
                <Ban size={11} /> Blocked
              </span>
            )}
          </div>
          <button
            className="mt-1 inline-flex items-center gap-1 text-xs text-faint hover:text-zinc-100"
            onClick={onToggle}
          >
            <Info size={11} /> score {item.score} — {open ? "hide" : "why?"}
          </button>
          {open && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {item.reasons.map((r, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-muted">{r.label}</span>
                  <span className={`tabular-nums ${r.points > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                    {r.points > 0 ? "+" : ""}
                    {r.points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-1 text-xs text-accent-soft hover:underline"
          onClick={onOpen}
        >
          Open <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
