import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useTasks } from "@/data/hooks";
import { useMadeline } from "@/store/madeline";
import { taskItem } from "@/lib/madelineItems";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/db";

/**
 * AI quick actions on the page itself (13 Oct 2026 call with Abder).
 *
 * Top right of the page, labelled in words, and the main way to get an answer
 * fast: one click runs it and the answer opens in a pop-up over the page. The
 * Madeline chat is for general questions and answers in the chat; these are the
 * shortcuts.
 *
 * Tasks first, three actions, so they can be tested before the other pages get
 * theirs (Abder is writing the definitions for each page). Add a page by adding
 * an entry to PAGES.
 *
 * Context stays small on purpose: each prompt names the job, and Madeline's
 * server looks up only the tasks it needs through its own tools (limited
 * queries), rather than the whole board being pasted into every request.
 */

interface PageAction {
  label: string;
  prompt: string;
  /** Attach the most pressing open task as "this task". */
  onTask?: boolean;
}

const PAGES: { match: (path: string) => boolean; actions: PageAction[] }[] = [
  {
    match: (p) => p === "/tasks",
    actions: [
      {
        label: "Prioritize my board",
        prompt:
          "Prioritise my task board. Look at my open tasks (to do, in progress, waiting and review) and tell me the three to work on next, in order, with one line each on why. Then flag any task whose priority or due date looks wrong, and anything I could drop or hand off. Keep it short.",
      },
      {
        label: "Break down a task",
        prompt: "Break this task into 3 to 7 concrete steps I can tick off, in order. Keep each step to one line.",
        onTask: true,
      },
      {
        label: "Find stuck tasks",
        prompt:
          "Find my stuck tasks: anything blocked, waiting on someone, overdue, or with no update in the last few days. For each one, say in one line why it's stuck and the single next step to move it, and offer to draft a follow-up where someone else is holding it up. Most urgent first.",
      },
    ],
  },
];

const at = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Overdue first, then the soonest due, then the most recently touched. */
function mostPressing(tasks: Task[]): Task | undefined {
  return tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (at(a.due_at) || Infinity) - (at(b.due_at) || Infinity) || at(b.updated_at) - at(a.updated_at))[0];
}

/* Draw the eye until someone has tried them once, then sit quietly. */
const TRIED_KEY = "madeea-ai-actions-tried";
const readTried = () => { try { return localStorage.getItem(TRIED_KEY) === "1"; } catch { return true; } };

export function PageAiActions() {
  const { pathname } = useLocation();
  const page = PAGES.find((p) => p.match(pathname));
  const { data: tasks = [] } = useTasks();
  const openItem = useMadeline((s) => s.item);
  const [tried, setTried] = useState(readTried);
  useEffect(() => setTried(readTried()), [pathname]);

  // The task an action is about: the one open in Madeline if it's a task, else the most pressing.
  const focus = useMemo(() => {
    if (openItem?.kind === "task") return null;
    return mostPressing(tasks) ?? null;
  }, [openItem, tasks]);

  if (!page) return null;
  const hasWork = tasks.some((t) => t.status !== "done");

  function run(a: PageAction) {
    try { localStorage.setItem(TRIED_KEY, "1"); } catch { /* storage blocked */ }
    setTried(true);
    const item = a.onTask && focus ? taskItem(focus) : undefined;
    useMadeline.getState().ask(a.prompt, {
      item,
      display: "modal",
      title: a.onTask && focus ? `${a.label}: ${focus.title}` : a.label,
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2" data-tour="ai-actions">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Sparkles size={14} className="text-accent" /> AI actions
      </span>
      {page.actions.map((a) => {
        const disabled = !hasWork || (a.onTask && !focus && openItem?.kind !== "task");
        return (
          <button
            key={a.label}
            type="button"
            onClick={() => run(a)}
            disabled={disabled}
            title={disabled ? "Add a task first" : a.onTask && focus ? `For: ${focus.title}` : undefined}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-full border border-accent/50 bg-[var(--nav-active-bg)] px-3.5 text-sm font-semibold text-[color:var(--nav-active-text)] transition-colors hover:border-accent hover:bg-accent hover:text-white disabled:pointer-events-none disabled:opacity-40",
              !tried && !disabled && "ai-attention",
            )}
          >
            <Sparkles size={14} /> {a.label}
          </button>
        );
      })}
    </div>
  );
}
