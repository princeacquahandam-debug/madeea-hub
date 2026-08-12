// Demo-mode EOD submissions. Demo has no DB, so a submitted report lives in
// localStorage and is layered over the imported July history on read, the same
// trick demoTasks/demoAssignees use.
import type { EodReport } from "@/types/db";

const KEY = "madeea-demo-eod";

export function loadDemoEod(): EodReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as EodReport[]) : [];
  } catch {
    return [];
  }
}

export function removeDemoEod(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadDemoEod().filter((r) => r.id !== id)));
  } catch {
    /* demo only */
  }
}

/** Upsert by person + date, so re-submitting a day corrects it instead of duplicating. */
export function saveDemoEod(report: EodReport): void {
  const all = loadDemoEod().filter(
    (r) => !(r.person === report.person && r.report_date === report.report_date),
  );
  all.push(report);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* quota. Demo only, safe to drop */
  }
}
