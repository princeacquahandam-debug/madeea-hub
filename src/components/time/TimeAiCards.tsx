import { useState } from "react";
import { Check, MessageSquare } from "lucide-react";
import { AiCard } from "@/components/ai/AiResult";
import { dayLabel, hm, MISSING_EMPTY, WEEK_EMPTY, type MissingRow, type WeekAnswer } from "@/lib/timeAi";

/**
 * The Time tracker's two inline cards (Abder's "AI quick actions and cost"
 * deck, 6 Nov 2026): "Summarize my week" and "Check missing hours". Both sit
 * above the clock and change nothing; the second is worked out entirely in
 * code, with no AI call.
 */

export function WeekCard({
  at, loading, error, answer, empty, onClose, onRefresh, onViewTimesheet,
}: {
  at: Date;
  loading: boolean;
  error: string | null;
  answer: WeekAnswer | null;
  empty: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onViewTimesheet: () => void;
}) {
  return (
    <AiCard
      title="Your week"
      source="your shifts this week and the workspace's daily hours"
      at={at}
      loading={loading}
      error={error}
      summary={empty ? undefined : answer?.summary}
      empty={empty ? WEEK_EMPTY : null}
      onClose={onClose}
      onRefresh={onRefresh}
      chat={answer ? `About my hours this week: ${answer.summary} ${answer.rows.map((r) => `${r.label} ${r.value}`).join("; ")}. What should I do about it?` : undefined}
      footer={<button className="btn-ghost border border-border px-2.5 py-1 text-xs" onClick={onViewTimesheet}>View timesheet</button>}
    >
      {answer && (
        <ul className="divide-y divide-border" data-testid="ai-week-rows">
          {answer.rows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
              {r.note && <span className="min-w-0 truncate text-xs text-muted">{r.note}</span>}
              <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </AiCard>
  );
}

const SHOWN = 5;

export function MissingCard({
  at, rows, period, dailyLabel, onClose, onRequest,
}: {
  at: Date;
  rows: MissingRow[];
  /** "this week so far", "1 Nov – 7 Nov". */
  period: string;
  dailyLabel: string;
  onClose: () => void;
  onRequest: (row: MissingRow) => void;
}) {
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const short = rows.reduce((a, r) => a + (r.expected - r.seconds), 0);
  const shown = rows.slice(0, SHOWN);
  return (
    <AiCard
      title="Missing hours"
      source={`your shifts, ${period}, against ${dailyLabel} each weekday (worked out in the app, no AI)`}
      at={at}
      summary={rows.length ? `${rows.length} ${rows.length === 1 ? "day is" : "days are"} short, ${hm(short)} in total.` : undefined}
      empty={rows.length ? null : MISSING_EMPTY}
      onClose={onClose}
      chat={rows.length ? `My timesheet is short on ${rows.map((r) => `${dayLabel(r.day)} (${hm(r.seconds)} of ${hm(r.expected)})`).join(", ")}. Help me ask my admin for a correction.` : undefined}
      footer={rows.length > SHOWN ? <span className="text-xs text-faint">{rows.length - SHOWN} more not shown. Weekends are skipped; holidays and leave aren't recorded in the app.</span> : <span className="text-xs text-faint">Weekends are skipped; holidays and leave aren't recorded in the app.</span>}
    >
      <ul className="divide-y divide-border" data-testid="ai-missing-rows">
        {shown.map((r) => (
          <li key={r.day} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <span className="w-28 shrink-0 font-medium">{dayLabel(r.day)}</span>
            <span className="min-w-0 flex-1 tabular-nums text-muted">{hm(r.seconds)} / {hm(r.expected)}</span>
            {asked.has(r.day) ? (
              <span className="inline-flex h-7 items-center gap-1 text-xs font-semibold text-emerald-600"><Check size={12} /> Draft ready</span>
            ) : (
              <button
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold transition-colors hover:bg-[var(--chip-bg)]"
                title="Opens a pre-filled message to your admin, ready to edit"
                onClick={() => { onRequest(r); setAsked((s) => new Set(s).add(r.day)); }}
              >
                <MessageSquare size={12} /> Request correction
              </button>
            )}
          </li>
        ))}
      </ul>
    </AiCard>
  );
}
