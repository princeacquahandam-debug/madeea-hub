import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useMessages, useTasks } from "@/data/hooks";
import { useMadeline } from "@/store/madeline";
import { taskItem } from "@/lib/madelineItems";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/db";

/**
 * AI quick actions on the page itself (13 Oct 2026 call with Abder).
 *
 * Labelled in words and the main way to get an answer fast: one click runs it
 * and the answer opens in a pop-up over the page. The Madeline chat is for
 * general questions and answers in the chat; these are the shortcuts.
 *
 * Two placements, from Abder's mockups:
 *   "strip"  a row at the top right of the page, above its title (Tasks);
 *   "inline" small buttons right beside the page title (Inbox), rendered by
 *            the page itself with <InlineAiActions path="/inbox" />.
 * Add a page by adding an entry to PAGES; Abder is writing the definitions.
 *
 * Context stays small on purpose: each prompt names the job, and Madeline's
 * server looks up only the tasks or messages it needs through its own tools
 * (limited queries), rather than everything being pasted into every request.
 */

interface PageAction {
  label: string;
  prompt: string;
  /** Attach the most pressing open task as "this task". */
  onTask?: boolean;
}

interface PageConfig {
  path: string;
  placement: "strip" | "inline";
  /** What there has to be something of, for the buttons to be worth pressing. */
  needs: "tasks" | "messages";
  actions: PageAction[];
}

const PAGES: PageConfig[] = [
  {
    // Tasks renders its own buttons beside the title (pages/Tasks.tsx):
    // Prioritize board and Find stuck tasks are worked out from the board
    // itself, per Abder's answer spec. Kept here for reference only.
    path: "/tasks-legacy",
    placement: "strip",
    needs: "tasks",
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
  {
    // Abder's Inbox mockup: three buttons beside the title.
    path: "/inbox",
    placement: "inline",
    needs: "messages",
    actions: [
      {
        label: "Summarize unread",
        prompt:
          "Summarise my unread and unanswered messages across every channel: for each, who it's from, what they want, and whether it needs a reply from me. Put anything urgent first. Keep it to one line per message.",
      },
      {
        label: "Draft replies",
        prompt:
          "Draft replies to the messages waiting on me (incoming and not yet answered), most urgent first, up to three. Write each one ready for me to review and edit, in my voice. Don't send anything.",
      },
      {
        label: "Find action items",
        prompt:
          "Go through my recent messages and pull out the action items: what I've been asked to do, by whom, and any deadline mentioned. List them most urgent first and offer to turn them into tasks.",
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

function ActionButtons({ page, compact }: { page: PageConfig; compact: boolean }) {
  const { pathname } = useLocation();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const openItem = useMadeline((s) => s.item);
  const [tried, setTried] = useState(readTried);
  useEffect(() => setTried(readTried()), [pathname]);

  // The task an action is about: the one open in Madeline if it's a task, else the most pressing.
  const focus = useMemo(() => (openItem?.kind === "task" ? null : mostPressing(tasks) ?? null), [openItem, tasks]);
  const hasWork = page.needs === "tasks"
    ? tasks.some((t) => t.status !== "done")
    : messages.some((m) => m.category !== "archive");

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
    <>
      {page.actions.map((a) => {
        const disabled = !hasWork || (a.onTask && !focus && openItem?.kind !== "task");
        return (
          <button
            key={a.label}
            type="button"
            onClick={() => run(a)}
            disabled={disabled}
            title={disabled ? (page.needs === "tasks" ? "Add a task first" : "Nothing in your inbox yet") : a.onTask && focus ? `For: ${focus.title}` : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-accent/50 bg-[var(--nav-active-bg)] font-semibold text-[color:var(--nav-active-text)] transition-colors hover:border-accent hover:bg-accent hover:text-white disabled:pointer-events-none disabled:opacity-40",
              compact ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-sm",
              !tried && !disabled && "ai-attention",
            )}
          >
            <Sparkles size={compact ? 12 : 14} /> {a.label}
          </button>
        );
      })}
    </>
  );
}

/** The row at the top right of a page. Mounted once, in AppShell. */
export function PageAiActions() {
  const { pathname } = useLocation();
  const page = PAGES.find((p) => p.placement === "strip" && p.path === pathname);
  if (!page) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2" data-tour="ai-actions">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Sparkles size={14} className="text-accent" /> AI actions
      </span>
      <ActionButtons page={page} compact={false} />
    </div>
  );
}

/** Buttons beside a page's title, for pages laid out that way (Inbox). */
export function InlineAiActions({ path }: { path: string }) {
  const page = PAGES.find((p) => p.placement === "inline" && p.path === path);
  if (!page) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-tour="ai-actions" aria-label="AI actions">
      <ActionButtons page={page} compact />
    </div>
  );
}
