import { useMemo } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How long, as a thing you drag rather than a sentence you type.
 *
 * WHY NOT A FREE TEXT BOX. It was one, and it asked for "e.g. 45 minutes",
 * which means every answer is a small act of transcription and some of them
 * ("an hour and a half", "1.5h", "90") are a parsing problem nobody needed.
 * Duration is a short list of real answers, so it is a slider over that list.
 *
 * NOT A LINEAR MINUTE SCALE. The useful values are not evenly spaced: the
 * difference between 15 and 30 minutes matters far more than between 180 and
 * 240, and a linear track spends most of its length in the region nobody picks.
 * The slider indexes a list of stops instead, so every position is a booking
 * somebody would actually make.
 *
 * The value it stores stays human ("45 minutes"), because it is read by a
 * language model and by a person reviewing the form, not by a parser.
 */

const STOPS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];

export function label(mins: number): string {
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hours = `${h} hour${h === 1 ? "" : "s"}`;
  return m ? `${hours} ${m} minutes` : hours;
}

/** "1 hour 30 minutes" or "90" back to minutes, for a value already stored. */
function parse(value: string): number | null {
  if (!value) return null;
  const h = value.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const m = value.match(/(\d+)\s*(?:minutes?|mins?|m)\b/i);
  if (h || m) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? parseInt(m[1], 10) : 0));
  const bare = value.match(/^\s*(\d+)\s*$/);
  return bare ? parseInt(bare[1], 10) : null;
}

/** The stop at or nearest below a value, so a prefilled "50 minutes" lands somewhere real. */
function nearestIndex(mins: number): number {
  let best = 0;
  let diff = Infinity;
  STOPS.forEach((s, i) => {
    const d = Math.abs(s - mins);
    if (d < diff) { diff = d; best = i; }
  });
  return best;
}

export function DurationSlider({ value, onChange, id }: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const index = useMemo(() => {
    const mins = parse(value);
    return mins === null ? 2 : nearestIndex(mins); // 45 minutes when nothing is set
  }, [value]);

  const mins = STOPS[index];
  const pct = (index / (STOPS.length - 1)) * 100;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <Clock size={13} className="shrink-0 text-faint" />
        <span className="text-sm font-medium tabular-nums">{label(mins)}</span>
        {/* The stops either side, so the scale is legible without dragging it
            to find out what the next step is. */}
        <span className="ml-auto text-[11px] tabular-nums text-faint">
          {STOPS[0]} min to {label(STOPS[STOPS.length - 1])}
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={0}
        max={STOPS.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(label(STOPS[Number(e.target.value)]))}
        aria-label="How long"
        aria-valuetext={label(mins)}
        className="w-full accent-[rgb(var(--c-accent-strong))]"
        style={{ background: `linear-gradient(to right, rgb(var(--c-accent-strong)) ${pct}%, var(--chip-bg) ${pct}%)` }}
      />

      {/* The common ones as buttons too. A slider is good for exploring the
          range and bad for hitting 30 exactly on a trackpad. */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {[15, 30, 45, 60, 90].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(label(m))}
            aria-pressed={mins === m}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] transition-colors",
              mins === m
                ? "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]"
                : "text-faint hover:bg-[var(--chip-bg)] hover:text-text",
            )}
          >
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </button>
        ))}
      </div>
    </div>
  );
}
