import { useMemo, useState } from "react";
import { CalendarPlus, Check, Loader2, AlertTriangle, ExternalLink, Link2 } from "lucide-react";
import { useCreateCalendarEvent, useGoogleConnection } from "@/data/hooks";
import { reconnectMail } from "@/hooks/useSendEmail";
import { zoneLabel } from "@/lib/calendarTime";
import { instantFor } from "@/lib/workday";
import { parseProposals, type Proposal } from "@/lib/planProposals";
import { cn } from "@/lib/utils";

export { parseProposals, type Proposal };

/**
 * The planner's suggestions, as things you can actually book.
 *
 * WHY THIS EXISTS. "Plan the Calendar" produced a paragraph describing a better
 * day, and then the person had to go and type every block of it into Google by
 * hand. That is most of the work it claimed to save, and it is the reason the
 * feature reads as pointless: a plan you cannot act on is an opinion.
 *
 * THE MODEL RETURNS WALL-CLOCK TIMES, NOT TIMESTAMPS, and that is deliberate.
 * It does not know which timezone the calendar is kept in, and a confident ISO
 * timestamp in the wrong zone books the middle of the night. "09:30" plus the
 * date plus the calendar's zone is a conversion this app can do correctly and
 * the model cannot.
 *
 * WHEN PARSING FAILS, THE PROSE STILL SHOWS. A missing or malformed block means
 * no buttons, never invented ones.
 */

export function PlanProposals({ proposals, date, tz }: {
  proposals: Proposal[];
  /** YYYY-MM-DD the blocks belong to. */
  date: string;
  tz: string;
}) {
  const create = useCreateCalendarEvent();
  const { data: google } = useGoogleConnection();
  const [booked, setBooked] = useState<Record<number, string | null>>({});
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canBook = Boolean(google?.canCreate) && validDate;

  async function book(i: number, p: Proposal) {
    setBusyIndex(i);
    setFailed((f) => { const { [i]: _drop, ...rest } = f; return rest; });
    try {
      const res = await create.mutateAsync({
        title: p.title,
        startsAt: instantFor(date, p.start, tz),
        endsAt: instantFor(date, p.end, tz),
        timeZone: tz,
        description: p.why ? `Planned in MadeEA OS: ${p.why}` : undefined,
      });
      setBooked((b) => ({ ...b, [i]: res.htmlLink }));
    } catch (e) {
      setFailed((f) => ({ ...f, [i]: e instanceof Error ? e.message : "Could not add this block." }));
    } finally {
      setBusyIndex(null);
    }
  }

  const remaining = useMemo(
    () => proposals.map((_, i) => i).filter((i) => !(i in booked)),
    [proposals, booked],
  );

  if (proposals.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5 text-[12.5px] text-muted">
        Nothing worth adding to this day.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <p className="field-label !mb-0">Proposed blocks</p>
        <span className="text-[11px] text-faint">
          {validDate ? `${date} · ${zoneLabel(tz, date)}` : "No date given, so these cannot be booked"}
        </span>
        {remaining.length > 1 && canBook && (
          <button
            className="btn-ghost ml-auto border border-border px-2 py-1 text-[11.5px]"
            disabled={busyIndex !== null}
            onClick={async () => {
              /* Sequential, not Promise.all. Six concurrent inserts against the
                 same calendar is how you get rate-limited into a half-booked
                 day, and a half-booked day is worse than a refused one. */
              for (const i of remaining) await book(i, proposals[i]);
            }}
          >
            <CalendarPlus size={12} /> Add all {remaining.length}
          </button>
        )}
      </div>

      {!google?.canCreate && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[12.5px] text-amber-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            This Google connection can read your calendar but not add to it.{" "}
            <button className="underline underline-offset-2" onClick={() => void reconnectMail("gmail").then(setConnectError)}>
              <Link2 size={11} className="inline" /> Reconnect and allow calendar changes
            </button>
          </span>
        </p>
      )}
      {connectError && (
        <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[12.5px] text-amber-200">{connectError}</p>
      )}

      <ul className="space-y-1.5">
        {proposals.map((p, i) => {
          const done = i in booked;
          return (
            <li
              key={`${p.start}-${p.title}-${i}`}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5",
                done && "opacity-70",
              )}
            >
              <span className="w-[92px] shrink-0 text-[12px] tabular-nums text-accent-soft">
                {p.start} to {p.end}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.title}</span>
                {p.why && <span className="block truncate text-[11.5px] text-faint">{p.why}</span>}
              </span>

              {done ? (
                <span className="flex items-center gap-1.5 text-[12px] text-emerald-300">
                  <Check size={13} /> Added
                  {booked[i] && (
                    <a href={booked[i]!} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      <ExternalLink size={11} className="inline" /> Open
                    </a>
                  )}
                </span>
              ) : (
                <button
                  className="btn-ghost shrink-0 border border-border px-2 py-1 text-[11.5px]"
                  onClick={() => book(i, p)}
                  disabled={!canBook || busyIndex !== null}
                  title={canBook ? "Add this block to your Google Calendar" : "Reconnect Google to allow calendar changes"}
                >
                  {busyIndex === i ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />}
                  {busyIndex === i ? "Adding…" : "Add"}
                </button>
              )}

              {failed[i] && (
                <p className="w-full text-[11.5px] text-amber-300">{failed[i]}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
