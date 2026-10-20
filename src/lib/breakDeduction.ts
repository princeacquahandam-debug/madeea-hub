import type { TimeEntry } from "../types/db";

/**
 * Automatic break deduction (19 Oct 2026 team meeting, migration 0089).
 *
 * The usual payroll rule: a working day longer than `afterHours` has an unpaid
 * break of `breakMinutes` taken off it. Breaks already taken with Pause count
 * toward it, so nobody loses the same break twice. Off when breakMinutes is 0.
 *
 * Pure, so the Time tracker's totals and its timesheet days agree.
 */
export interface BreakRule { breakMinutes: number; afterHours: number }

export interface DayTotal {
  /** Seconds clocked in. */
  worked: number;
  /** Seconds taken off automatically (0 when the rule doesn't apply). */
  deducted: number;
  /** What counts: worked minus deducted. */
  net: number;
}

/** Breaks already taken with Pause: from a paused session's end to the next session's start. */
export function pausedBreakSeconds(day: TimeEntry[]): number {
  const s = [...day].sort((a, b) => a.started_at.localeCompare(b.started_at));
  let total = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i].paused && s[i].ended_at) {
      total += Math.max(0, (Date.parse(s[i + 1].started_at) - Date.parse(s[i].ended_at!)) / 1000);
    }
  }
  return Math.round(total);
}

export function dayTotal(day: TimeEntry[], workedSeconds: number, rule: BreakRule | null): DayTotal {
  if (!rule || rule.breakMinutes <= 0 || workedSeconds <= rule.afterHours * 3600) {
    return { worked: workedSeconds, deducted: 0, net: workedSeconds };
  }
  const owed = Math.max(0, rule.breakMinutes * 60 - pausedBreakSeconds(day));
  const deducted = Math.min(owed, workedSeconds);
  return { worked: workedSeconds, deducted, net: workedSeconds - deducted };
}
