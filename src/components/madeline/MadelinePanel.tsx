import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Check, CheckSquare, Copy, PanelRightClose, Paperclip, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Orb } from "@/components/layout/Orb";
import { ResultCard } from "@/components/command-center/ResultCard";
import { ConfirmDialog } from "@/components/command-center/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useMadelineEngine } from "@/hooks/useMadeline";
import { useMadeline, ITEM_LABEL, type MadelineItem, type MadelineItemKind, type MadelineTurn } from "@/store/madeline";
import { useMeetingNotes, useMeetings, useMessages, useTaskMutations, useTasks } from "@/data/hooks";
import { emailItem, meetingItem, taskItem } from "@/lib/madelineItems";
import { PREP_MEETING } from "@/lib/madelineActions";
import { useFollowUps } from "@/hooks/useFollowUps";
import { supabase } from "@/lib/supabase";
import type { Flag } from "@/lib/followups";
import { PlanProposals } from "@/components/calendar/PlanProposals";
import { useCalendarTimezone } from "@/data/hooks";
import type { Proposal } from "@/lib/planProposals";
import { renderMarkdown } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import type { Meeting, MeetingNote, Message, Priority, Task } from "@/types/db";

/** An AI action: one click opens Madeline and sends `prompt`. `item` attaches
    something as context (the meeting a prep is about). `hint` is the hover
    text when the label alone doesn't say which thing it means. */
interface Action { label: string; prompt: string; item?: Omit<MadelineItem, "path">; hint?: string }

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const at = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/* What each kind of open thing can be asked for. The labels are the client's
   spec, word for word: a label, never an icon alone, and the same on every page. */
const FOR_ITEM: Record<MadelineItemKind, Action[]> = {
  task: [
    { label: "Break into steps", prompt: "Break this task into 3 to 7 concrete steps I can tick off, in order." },
    { label: "Draft follow-up", prompt: "Draft a short follow-up message about this task for the person waiting on it (the client, if there is one). Make it ready to send, but don't send it." },
    { label: "Suggest priority", prompt: "Suggest a priority for this task (low, normal, high or urgent), weighing its due date against my other open tasks. Say why in one or two lines." },
  ],
  meeting: [
    { label: PREP_MEETING.title, prompt: PREP_MEETING.prompt },
    { label: "Summarize last meeting", prompt: "Summarise the last recorded meeting related to this one (same title, client or attendees): decisions, action items and anything still open." },
  ],
  email: [
    { label: "Summarize thread", prompt: "Summarise this email thread: what's been said, what's being asked of me, and any deadlines." },
    { label: "Draft reply", prompt: "Draft a reply to this email in my voice, ready for me to review. Don't send anything." },
    { label: "Turn into task", prompt: "Turn this email into a task for me to review: propose a title, priority and due date." },
  ],
  client: [
    { label: "Client brief", prompt: "Give me a brief on this client: who they are, how they like to work, and what's going on with them right now." },
    { label: "What's pending for them?", prompt: "What's pending for this client? Their open and overdue tasks, emails waiting on a reply, and upcoming meetings." },
  ],
};

/**
 * The AI actions for where the user is. The open thing (a task, meeting,
 * email or client) decides first, wherever it was opened; otherwise the page
 * does, from the same data the page shows.
 *
 * Only where there's something to work on: an empty day has no "Plan my day",
 * a calendar with no recordings has no "Summarize last meeting". A chip that
 * leads to "you have nothing" teaches people to ignore the chips.
 */
function pageActions(
  path: string,
  item: MadelineItem | null,
  tasks: Task[], meetings: Meeting[], messages: Message[], notes: MeetingNote[],
): Action[] {
  if (item) return FOR_ITEM[item.kind];

  const now = Date.now();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => at(t.due_at) < start.getTime());
  const dueToday = open.filter((t) => at(t.due_at) >= start.getTime() && at(t.due_at) < end.getTime());
  const meetingsToday = meetings.filter((m) => at(m.starts_at) >= start.getTime() && at(m.starts_at) < end.getTime());
  const waiting = messages.filter((m) => m.direction !== "outbound" && !m.first_reply_at);
  const blocked = open.filter((t) => t.blocked);

  const out: Action[] = [];
  if (path === "/") {
    if (meetingsToday.length || dueToday.length || overdue.length) {
      out.push({ label: "Plan my day", prompt: "Plan my day: put today's meetings and my tasks due today or overdue into a realistic order with times, and flag anything that won't fit." });
    }
    if (overdue.length || waiting.length || blocked.length) {
      out.push({ label: "What needs attention?", prompt: "What needs my attention right now? Check overdue and blocked tasks, emails waiting on a reply and today's meetings. Most urgent first." });
    }
  } else if (path.startsWith("/tasks")) {
    if (open.length) {
      out.push({ label: "Suggest priority", prompt: "Look at my open tasks and suggest what to prioritise: the three to do next, and any whose priority looks wrong." });
    }
  } else if (path.startsWith("/calendar")) {
    // Nothing open: "this meeting" is the next one, named on hover and
    // attached as context so the answer is about it.
    const next = meetings
      .filter((m) => at(m.starts_at) > now)
      .sort((a, b) => at(a.starts_at) - at(b.starts_at))[0];
    if (next) {
      const time = new Date(next.starts_at!).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
      out.push({ ...FOR_ITEM.meeting[0], item: meetingItem(next), hint: `Next: ${next.title}, ${time}` });
    }
    if (notes.length) {
      out.push({ label: "Summarize last meeting", prompt: "Summarise my most recent recorded meeting: decisions, action items and anything still open.", hint: `Last: ${notes[0].title}` });
    }
  }
  return out;
}

/**
 * The one Madeline panel. Docked beside the page on wide screens, sliding over
 * it below xl. Same component, same conversation, either way: the old rail and
 * floating bubble were two assistants with two histories, and crossing 1280px
 * swapped one for the other mid-conversation.
 */
export function MadelinePanel() {
  const open = useMadeline((s) => s.open);
  const setOpen = useMadeline((s) => s.setOpen);
  const turns = useMadeline((s) => s.turns);
  const clearTurns = useMadeline((s) => s.clearTurns);
  const draft = useMadeline((s) => s.draft);
  const setDraft = useMadeline((s) => s.setDraft);
  const focusToken = useMadeline((s) => s.focusToken);
  const setItem = useMadeline((s) => s.setItem);
  const { send, running, pendingConfirm, item, pageLabel } = useMadelineEngine();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings({ mine: true });
  const { data: messages = [] } = useMessages();
  const { data: notes = [] } = useMeetingNotes();
  const { flags } = useFollowUps();
  const routePath = useMadeline((s) => s.routePath);
  const actions = useMemo(
    () => pageActions(routePath, item, tasks, meetings, messages, notes),
    [routePath, item, tasks, meetings, messages, notes],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, open]);

  // A page button filled the box: put the cursor at the end, ready to send.
  useEffect(() => {
    if (!open || !focusToken) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusToken, open]);

  // Grow the box with what's typed, up to about six lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, open]);

  // Esc closes the slide-over. Docked on xl it stays, like any sidebar.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingConfirm && window.innerWidth < 1280) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingConfirm, setOpen]);

  if (!open) return null;

  const firstName = user?.name?.split(" ")[0];

  function submit() {
    if (running || !draft.trim()) return;
    send(draft);
  }

  function runAction(a: Action) {
    // One click: runs now and answers in the pop-up over the page.
    useMadeline.getState().ask(a.prompt, { item: a.item, display: "modal", title: a.label });
  }

  const go = (path: string) => navigate(path);

  /* Portalled to <body>. AppShell's root is `relative z-10`, a stacking
     context, so inside it z-[85] only outranks its siblings. Modals portal to
     <body> at z-[80] and were drawn over the panel, dimming it and eating its
     clicks at exactly the moment it has the open task as context. */
  return createPortal(
    <>
      {/* Below xl the panel covers the page, so the page dims and a tap outside closes it. */}
      <div className="fixed inset-0 z-[84] bg-black/50 xl:hidden" onClick={() => setOpen(false)} aria-hidden="true" />

      {/* z-[85] sits above page modals (z-[80]), so Madeline stays usable with a
          task or client open. That's exactly when it has something as context. */}
      <aside
        className={cn(
          "fixed right-0 z-[85] flex flex-col border-l border-border p-4 backdrop-blur-lg",
          "top-0 h-full w-full sm:w-[380px]",
          "xl:top-[66px] xl:h-[calc(100vh-66px)] xl:w-[340px]",
        )}
        style={{ background: "var(--glass)", animation: "slideInChip 0.3s cubic-bezier(0.22,1,0.36,1)" }}
        aria-label="Madeline"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <Orb size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold tracking-tight">Madeline</p>
            <p className="truncate text-xs font-semibold text-accent" title={`You're on ${pageLabel}`}>
              On {pageLabel}
            </p>
          </div>
          {turns.length > 0 && (
            <button
              onClick={clearTurns}
              title="New conversation"
              aria-label="Start a new conversation"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            title="Close"
            aria-label="Close Madeline"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          >
            <PanelRightClose size={18} className="hidden xl:block" />
            <X size={18} className="xl:hidden" />
          </button>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto py-3 pr-1" aria-live="polite">
          {turns.length === 0 && (
            <Welcome
              firstName={firstName}
              item={item}
              tasks={tasks}
              meetings={meetings}
              messages={messages}
              flags={flags}
              disabled={running}
              onPick={(sg) => useMadeline.getState().ask(sg.prompt, { item: sg.item, display: "modal", title: sg.label })}
            />
          )}
          {turns.map((t) => <TurnView key={t.id} turn={t} onNavigate={go} />)}
        </div>

        {/* AI actions for this page or the open item. Always a word label.
            They wrap: a sideways-scrolling row cut the last chip in half
            ("Pre…") and hid the rest with no sign there were more. */}
        {actions.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 pb-2" role="group" aria-label="AI actions">
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={() => runAction(a)}
                disabled={running}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-bold transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                title={a.hint ?? a.label}
              >
                <Sparkles size={12} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate">{a.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* What Madeline is looking at. Removable: sometimes you want to ask
            about something else without closing the task first. */}
        {item && (
          <div className="mb-2 flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs">
            <Paperclip size={12} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-bold">{ITEM_LABEL[item.kind]}:</span> {item.label}
            </span>
            <button onClick={() => setItem(null)} aria-label="Don't use this as context" className="shrink-0 text-faint hover:text-text">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Input. The focus ring belongs to the rounded box, not the textarea.
            The global :focus-visible outline (index.css) ties with Tailwind's
            outline-none and wins by coming later, so it drew a square ring
            2px inside the pill. focus-visible:outline-none outranks it. */}
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex shrink-0 items-end gap-2 rounded-2xl border border-border py-1.5 pl-3.5 pr-1.5 transition-shadow focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40"
          style={{ background: "var(--glass-2)" }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
            placeholder={item ? `Ask about this ${ITEM_LABEL[item.kind].toLowerCase()}…` : "Ask about your tasks, clients, meetings…"}
            aria-label="Message Madeline"
            className="min-w-0 flex-1 resize-none bg-transparent py-2 text-[13px] leading-snug text-text outline-none placeholder:text-faint focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={running || !draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-transform hover:scale-105 disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        </form>

        {pendingConfirm && (
          <ConfirmDialog label={pendingConfirm.label} onConfirm={pendingConfirm.onConfirm} onCancel={pendingConfirm.onCancel} />
        )}
      </aside>
    </>,
    document.body,
  );
}

function TurnView({ turn, onNavigate }: { turn: MadelineTurn; onNavigate: (path: string) => void }) {
  return (
    <>
      <div className="flex max-w-[88%] flex-col items-end gap-1 self-end">
        {turn.about && <span className="truncate text-[10.5px] font-semibold text-faint">About {turn.about}</span>}
        <div className="whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-accent px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
          {turn.prompt}
        </div>
      </div>
      {turn.status === "running" && (
        <div className="flex items-start gap-2 self-start">
          <span className="madeline-orb madeline-orb-still mt-1.5 h-[22px] w-[22px] shrink-0" aria-hidden="true" />
          <div className="rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3 py-2.5">
            <span className="cc-typing" aria-label="Madeline is thinking"><span /><span /><span /></span>
          </div>
        </div>
      )}
      {turn.result?.kind === "text" && <AiReply turn={turn} />}
      {turn.result && turn.result.kind !== "text" && (
        <div className="max-w-[92%] self-start">
          <ResultCard result={turn.result} onNavigate={onNavigate} />
        </div>
      )}
    </>
  );
}

/* ── Madeline's first screen ───────────────────────────────────────────────
   Instead of an empty chat, what she can do today from the user's real work:
   a greeting with a one-line summary, up to three suggestions built from
   today's meetings, follow-ups and deadlines, and one quiet line of examples
   so a non-technical user knows what to ask. */

interface Suggestion { label: string; prompt: string; item?: Omit<MadelineItem, "path"> }

function greetingWord(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Welcome({
  firstName, item, tasks, meetings, messages, flags, onPick, disabled,
}: {
  firstName?: string;
  item: MadelineItem | null;
  tasks: Task[]; meetings: Meeting[]; messages: Message[]; flags: Flag[];
  onPick: (s: Suggestion) => void;
  disabled: boolean;
}) {
  const { summary, suggestions } = useMemo(() => {
    const now = Date.now();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const open = tasks.filter((t) => t.status !== "done");
    const dueToday = open.filter((t) => at(t.due_at) >= start.getTime() && at(t.due_at) < end.getTime());
    const overdue = open.filter((t) => at(t.due_at) < start.getTime());
    const today = meetings.filter((m) => at(m.starts_at) >= start.getTime() && at(m.starts_at) < end.getTime());

    const parts = [`${plural(dueToday.length, "task")}`, `${plural(today.length, "meeting")}`];
    const summary = dueToday.length || today.length || overdue.length
      ? `You have ${parts.join(" and ")} today${overdue.length ? `, plus ${overdue.length} overdue` : ""}. Want a hand?`
      : "Nothing's due today. Want to look at what's coming up?";

    const out: Suggestion[] = [];
    const next = meetings
      .filter((m) => at(m.starts_at) > now && at(m.starts_at) < now + 24 * 3_600_000)
      .sort((a, b) => at(a.starts_at) - at(b.starts_at))[0];
    if (next) {
      const time = new Date(next.starts_at!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      out.push({
        label: next.with && next.with !== "Internal" ? `Prep me for the ${time} with ${shorten(next.with, 22)}` : `Prep me for ${shorten(next.title, 24)} at ${time}`,
        prompt: PREP_MEETING.prompt,
        item: meetingItem(next),
      });
    }
    const flag = flags[0];
    if (flag) {
      const who = flag.subtitle && flag.subtitle !== "No client" ? flag.subtitle : shorten(flag.title, 26);
      const task = flag.itemType === "task" ? tasks.find((t) => t.id === flag.itemId) : undefined;
      const msg = flag.itemType === "message" ? messages.find((m) => m.id === flag.itemId) : undefined;
      out.push({
        label: `Draft a follow-up to ${shorten(who, 26)} (${plural(flag.days, "day")})`,
        prompt: `Draft a short follow-up about this. ${flag.reason}, so acknowledge that and ask for an update. Ready to send, but don't send it.`,
        item: task ? taskItem(task) : msg ? emailItem(msg) : undefined,
      });
    }
    const day = new Date().getDay(); // 0 Sun … 6 Sat
    if (open.some((t) => t.due_at)) {
      out.push(day >= 1 && day <= 4
        ? { label: "What's due before Friday?", prompt: "What's due before the end of Friday? My tasks due by then, most urgent first." }
        : { label: "What's due next week?", prompt: "What's due next week? My tasks due in the next 7 days, most urgent first." });
    }
    if (!out.length) out.push({ label: "What's on my plate today?", prompt: "What's on my plate today?" });
    return { summary, suggestions: out.slice(0, 3) };
  }, [tasks, meetings, messages, flags]);

  return (
    <div className="flex flex-col gap-3 px-1 pt-1">
      <div>
        <p className="text-lg font-extrabold tracking-tight">{greetingWord()}{firstName ? `, ${firstName}` : ""}.</p>
        <p className="mt-0.5 text-[13px] text-muted">
          {item ? `You have ${ITEM_LABEL[item.kind].toLowerCase()} "${shorten(item.label, 60)}" open. Pick an action below or ask about it.` : summary}
        </p>
      </div>
      {!item && (
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Suggested for today</p>
          <div className="flex flex-col gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                onClick={() => onPick(s)}
                disabled={disabled}
                className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-faint">I can also help with emails, meeting prep, client briefs and SOPs.</p>
    </div>
  );
}

/* ── An answer ─────────────────────────────────────────────────────────────
   Short text first (the server asks for one sentence and a few bullets),
   then: the sources it read ("4 meetings · 2 tasks", each opens its page),
   the next step as a button, and 👍/👎.

   Two kinds of fenced block can ride at the end of a reply and are turned
   into UI instead of shown as code:
     ```task  {title, priority, due}   → "Create task" card (nothing is saved
                                          until the user presses it)
     ```next  [{label, prompt|open}]   → next-step buttons */

interface ProposedTask { title: string; priority: Priority; due: string | null }
interface NextStep { label: string; prompt?: string; open?: string }

const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
const OPEN_PATHS: Record<string, string> = {
  tasks: "/tasks", calendar: "/calendar", inbox: "/inbox", clients: "/clients", sops: "/sops",
};
const SOURCE_LABEL: Record<string, [string, string]> = {
  tasks: ["task", "/tasks"],
  meetings: ["meeting", "/calendar"],
  emails: ["email", "/inbox"],
  clients: ["client", "/clients"],
  sops: ["SOP", "/sops"],
  meeting_notes: ["meeting note", "/meeting-intelligence"],
};

function takeBlock(markdown: string, lang: string): { text: string; json: unknown } {
  const m = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)```").exec(markdown);
  if (!m) return { text: markdown, json: undefined };
  try {
    return { text: markdown.replace(m[0], "").trim(), json: JSON.parse(m[1]) };
  } catch {
    return { text: markdown.replace(m[0], "").trim(), json: undefined };
  }
}

interface DayPlan { date: string; blocks: Proposal[] }

function parseReply(markdown: string): { text: string; task: ProposedTask | null; next: NextStep[]; plan: DayPlan | null } {
  const t = takeBlock(markdown, "task");
  const pl = takeBlock(t.text, "plan");
  const n = takeBlock(pl.text, "next");
  /* Same checks the old planner made (lib/planProposals): HH:MM times, ends
     after it starts, at most six. A malformed block means no buttons. */
  const hhmm = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const rawPlan = pl.json as { date?: unknown; blocks?: unknown } | undefined;
  const blocks = (Array.isArray(rawPlan?.blocks) ? rawPlan!.blocks : [])
    .filter((b): b is Proposal => {
      const o = b as Proposal;
      return Boolean(o && typeof o.title === "string" && o.title.trim() && typeof o.start === "string" && hhmm.test(o.start)
        && typeof o.end === "string" && hhmm.test(o.end) && o.end > o.start);
    })
    .slice(0, 6);
  const plan = typeof rawPlan?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawPlan.date) && blocks.length
    ? { date: rawPlan.date, blocks }
    : null;
  let task: ProposedTask | null = null;
  const raw = t.json as { title?: unknown; priority?: unknown; due?: unknown } | undefined;
  if (raw && typeof raw.title === "string" && raw.title.trim()) {
    task = {
      title: raw.title.trim().slice(0, 200),
      priority: PRIORITIES.includes(raw.priority as Priority) ? (raw.priority as Priority) : "normal",
      due: typeof raw.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : null,
    };
  }
  const next = (Array.isArray(n.json) ? n.json : [])
    .filter((x): x is NextStep =>
      !!x && typeof x.label === "string" && x.label.trim().length > 0 &&
      ((typeof x.prompt === "string" && x.prompt.trim().length > 0) || (typeof x.open === "string" && x.open in OPEN_PATHS)))
    .slice(0, 2)
    .map((x) => ({ label: x.label.trim().slice(0, 40), prompt: x.prompt?.slice(0, 600), open: x.open }));
  return { text: n.text, task, next, plan };
}

/** One answer. `bare` is the pop-up's version: no chat bubble or avatar,
    full width, and next steps that open in the pop-up too. */
export function AiReply({ turn, bare = false }: { turn: MadelineTurn; bare?: boolean }) {
  const markdown = turn.result?.kind === "text" ? turn.result.markdown : "";
  const { text, task, next, plan } = useMemo(() => parseReply(markdown), [markdown]);
  const { data: calendarTz } = useCalendarTimezone();
  const { create } = useTaskMutations();
  const { send, running } = useMadelineEngine();
  const { user, demo } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!task) return;
    setError(null);
    try {
      const res = await create.mutateAsync({ title: task.title, priority: task.priority, due_at: task.due });
      useMadeline.getState().patchTurn(turn.id, { createdTaskId: res?.id ?? "created" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The task couldn't be created.");
    }
  }

  function rate(r: 1 | -1) {
    const rating = turn.rating === r ? undefined : r;
    useMadeline.getState().patchTurn(turn.id, { rating });
    if (!supabase || demo || !user || !rating) return;
    void supabase.from("madeline_feedback").upsert({
      user_id: user.id,
      turn_id: turn.id,
      rating,
      prompt: turn.prompt.slice(0, 4000),
      reply: markdown.slice(0, 12000),
      page: useMadeline.getState().routePath,
    }, { onConflict: "user_id,turn_id" }).then(() => undefined, () => undefined);
  }

  const due = task?.due ? new Date(`${task.due}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "No due date";
  const sources = (turn.sources ?? []).filter((s) => SOURCE_LABEL[s.kind]);

  return (
    <>
      {text && (bare ? <BareMarkdown markdown={text} /> : <AiMarkdown markdown={text} />)}
      {task && (
        <div className={`${bare ? "" : "ml-[30px] max-w-[85%] self-start"} rounded-xl border border-accent/40 bg-accent/5 p-3 text-[13px]`}>
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Proposed task</p>
          <p className="mt-1 font-bold leading-snug">{task.title}</p>
          <p className="mt-0.5 text-xs text-muted">Priority {task.priority} · {due}</p>
          {turn.createdTaskId ? (
            <button onClick={() => navigate("/tasks")} className="mt-2.5 flex items-center gap-1.5 text-xs font-bold text-accent hover:underline">
              <Check size={13} /> Created. Open Task Manager
            </button>
          ) : (
            <button
              onClick={confirm}
              disabled={create.isPending}
              className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              <CheckSquare size={13} /> {create.isPending ? "Creating…" : "Create task"}
            </button>
          )}
          {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
        </div>
      )}

      {/* "Plan this day": each block books on its own button, so nothing
          lands on the calendar until it's pressed. */}
      {plan && (
        <div className={bare ? "" : "ml-[30px] max-w-[88%] self-start"}>
          <PlanProposals proposals={plan.blocks} date={plan.date} tz={calendarTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone} />
        </div>
      )}

      <div className={cn("flex flex-col gap-2", bare ? "pt-1" : "ml-[30px] max-w-[88%] self-start")}>
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="What this answer used">
            {sources.map((s) => {
              const [word, path] = SOURCE_LABEL[s.kind];
              return (
                <button
                  key={s.kind}
                  onClick={() => navigate(path)}
                  title={`Open ${path.slice(1).replace(/-/g, " ")}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  {plural(s.count, word)}
                </button>
              );
            })}
          </div>
        )}
        {next.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {next.map((n, i) => (
              <button
                key={n.label}
                disabled={running && !!n.prompt}
                onClick={() => (n.prompt ? send(n.prompt, bare ? { display: "modal", title: n.label } : undefined) : navigate(OPEN_PATHS[n.open!]))}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40",
                  i === 0 ? "bg-accent text-white hover:brightness-110" : "border border-accent text-accent hover:bg-accent/10",
                )}
              >
                {n.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => rate(1)}
            aria-label="Good answer"
            aria-pressed={turn.rating === 1}
            title="Good answer"
            className={cn("rounded-md p-1 transition-colors hover:text-text", turn.rating === 1 ? "text-accent" : "text-faint")}
          >
            <ThumbsUp size={13} fill={turn.rating === 1 ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => rate(-1)}
            aria-label="Bad answer"
            aria-pressed={turn.rating === -1}
            title="Bad answer"
            className={cn("rounded-md p-1 transition-colors hover:text-text", turn.rating === -1 ? "text-accent" : "text-faint")}
          >
            <ThumbsDown size={13} fill={turn.rating === -1 ? "currentColor" : "none"} />
          </button>
          {turn.rating && <span className="text-[10.5px] text-faint">Thanks, noted.</span>}
        </div>
      </div>
    </>
  );
}

/* Replies are markdown (lists, bold, the odd table), rendered through the
   app's sanitising pipeline. The rail showed them as raw text, asterisks and all. */
function BareMarkdown({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="md-body text-[14px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
      <button
        onClick={() => { navigator.clipboard?.writeText(markdown); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
        className="flex w-fit items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-faint hover:text-text"
        aria-label="Copy answer"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function AiMarkdown({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="group flex max-w-[92%] items-start gap-2 self-start">
      <span className="madeline-orb madeline-orb-still mt-1.5 h-[22px] w-[22px] shrink-0" aria-hidden="true" />
      <div className="relative min-w-0 rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed">
        <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
        <button
          onClick={copy}
          className="absolute -bottom-2.5 right-2 flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10.5px] text-faint opacity-0 transition-opacity hover:text-text focus:opacity-100 group-hover:opacity-100"
          aria-label="Copy reply"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
