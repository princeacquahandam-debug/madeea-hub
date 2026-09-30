/**
 * MadelineProvider, the engine behind the one Madeline panel.
 *
 * Every entry point (the top-bar button, ⌘K's "Ask Madeline about…", page
 * buttons like "Prep me for this meeting", the panel's own box) ends up in
 * `send`. That keeps one conversation, one set of rules and one backend.
 *
 * Two kinds of request:
 *  - A clear ACTION ("create a task to…", "remind me to…", "go to calendar")
 *    runs here, through the existing command tools, because it writes or
 *    navigates and the AI backend is read-only by design.
 *  - Everything else goes to the assistant-chat function with the whole
 *    thread, the page the user is on and the item they have open. It reads
 *    real tasks, meetings, emails, clients and SOPs as the user.
 *
 * The regex intent parser is deliberately NOT trusted beyond those actions.
 * It files "show me my open tasks" under local keyword search and "show me
 * unread emails" under "open a page called unread emails". Madeline's AI
 * answers both properly, so they go there.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useTaskMutations, useReminderMutations } from "@/data/hooks";
import { NAV } from "@/lib/constants";
import { assistantChat, generate, type ChatMessage } from "@/lib/ai";
import { useWorkspace, uid } from "@/store/workspace";
import { useMadeline, currentItem, ITEM_LABEL, type MadelineItem, type MadelineTurn } from "@/store/madeline";

import { parseIntent } from "@/lib/command-center/intentParser";
import { route, runTool } from "@/lib/command-center/commandRouter";
import { registerBuiltinTools } from "@/lib/command-center/tools";
import { resolvePath } from "@/lib/command-center/tools/navigationTools";
import type { ParsedCommand, ToolContext, ToolResult, WorkspaceApi } from "@/lib/command-center/types";

registerBuiltinTools();

interface PendingConfirm {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface MadelineEngine {
  send: (prompt: string) => void;
  running: boolean;
  pendingConfirm: PendingConfirm | null;
  /** The item the user has open on THIS page, if any. */
  item: MadelineItem | null;
  /** Human name of the current page ("Task Manager"), for context. */
  pageLabel: string;
}

const Ctx = createContext<MadelineEngine | null>(null);

/* How much of the thread goes back to the model. The function keeps the last
   20 messages anyway; sending more is just bytes. */
const HISTORY_TURNS = 10;

/** A result as plain text, for the next request's conversation history. */
function resultToText(r: ToolResult | undefined): string {
  if (!r) return "";
  switch (r.kind) {
    case "text": return r.markdown;
    case "created": return `${r.title}${r.detail ? `: ${r.detail}` : ""}`;
    case "navigate": return `Opened ${r.label}.`;
    case "search": return `Found ${r.results.length} results for "${r.query}".`;
    case "entity": return r.title;
    case "error": return r.message;
  }
}

const GO = /^\s*(?:please\s+)?(?:open|go to|navigate to|take me to)\b/i;

/** Should this run as a local action rather than go to the AI? */
function isLocalAction(parsed: ParsedCommand): boolean {
  if (parsed.intent === "create_task" || parsed.intent === "create_reminder") return true;
  // Only an explicit "go to X" where X is a real page. "Show me my emails" is
  // a question about emails, not a request to open the inbox.
  if (parsed.intent === "open_settings") return GO.test(parsed.raw);
  if (parsed.intent === "open_page") return GO.test(parsed.raw) && resolvePath(parsed.params.target ?? "") !== null;
  return false;
}

function pageLabelFor(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const nav = NAV.find((n) => n.to !== "/" && pathname.startsWith(n.to));
  if (nav) return nav.label;
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Dashboard";
}

export function MadelineProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ws = useWorkspace();
  const taskMutations = useTaskMutations();
  const reminderMutations = useReminderMutations();
  const storeItem = useMadeline((s) => s.item);
  const queued = useMadeline((s) => s.queued);

  const [running, setRunning] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const item = currentItem(storeItem, pathname);
  const pageLabel = pageLabelFor(pathname);

  useEffect(() => { useMadeline.setState({ routePath: pathname }); }, [pathname]);

  const workspace = useMemo<WorkspaceApi>(() => ({
    createProject: (title, description) => ws.addProject(title, description),
    createNote: (title, body, projectId) => ws.addNote(title, body, projectId),
    createTask: async (title) => {
      const local = ws.addTask(title);
      try { await taskMutations.create.mutateAsync({ title }); } catch { /* demo/no-op or offline */ }
      return local;
    },
    createReminder: async (label, remindAt) => {
      const local = ws.addReminder(label, remindAt);
      try { await reminderMutations.create.mutateAsync({ label, remind_at: new Date().toISOString() }); } catch { /* graceful */ }
      return local;
    },
    searchIndex: () => [],
  }), [ws, taskMutations, reminderMutations]);

  const send = useCallback((prompt: string) => {
    const raw = prompt.trim();
    if (!raw) return;
    const store = useMadeline.getState();
    const history = store.turns;
    const here = currentItem(store.item, store.routePath);
    const page = pageLabelFor(store.routePath);

    const turnId = uid("turn");
    const turn: MadelineTurn = {
      id: turnId,
      prompt: raw,
      about: here ? `${ITEM_LABEL[here.kind]} · ${here.label}` : undefined,
      status: "running",
    };
    store.addTurn(turn);
    store.setDraft("");
    setRunning(true);

    const done = (result: ToolResult) => {
      useMadeline.getState().patchTurn(turnId, { status: result.kind === "error" ? "error" : "done", result });
      setRunning(false);
    };

    const parsed = parseIntent(raw);

    if (isLocalAction(parsed)) {
      const ctx: ToolContext = {
        params: parsed.params,
        command: parsed,
        conversation: [],
        navigate,
        ai: {
          generate: (format, inputs) => generate({ tool: "quick_action", format, inputs }),
          chat: (messages) => assistantChat(messages),
        },
        workspace,
      };
      const decision = route(parsed, ctx);
      if (decision.status === "invalid") return done({ kind: "error", message: decision.message });
      const run = () => void runTool(decision.tool, ctx).then(done);
      if (decision.status === "needs_confirm") {
        setPendingConfirm({
          label: decision.label,
          onConfirm: () => { setPendingConfirm(null); run(); },
          onCancel: () => { setPendingConfirm(null); done({ kind: "error", message: "Cancelled." }); },
        });
        return;
      }
      return run();
    }

    // The AI. One message per side per turn, oldest first, then this question
    // once. (The old Command Center appended it twice.)
    const messages: ChatMessage[] = [];
    for (const t of history.slice(-HISTORY_TURNS)) {
      if (t.status === "running") continue;
      const answer = resultToText(t.result);
      messages.push({ role: "user", content: t.prompt });
      if (answer) messages.push({ role: "assistant", content: answer });
    }
    messages.push({ role: "user", content: raw });

    assistantChat(messages, {
      page,
      item: here ? { kind: here.kind, label: here.label, details: here.details } : undefined,
    })
      .then((reply) => done({ kind: "text", markdown: reply || "I couldn't come up with an answer to that. Try rephrasing it." }))
      .catch((e) => done({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
  }, [navigate, workspace]);

  // A page button asked for something to be sent ("Prep me for this meeting").
  useEffect(() => {
    if (queued === null) return;
    const q = useMadeline.getState().takeQueued();
    if (q) send(q);
  }, [queued, send]);

  const value: MadelineEngine = { send, running, pendingConfirm, item, pageLabel };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMadelineEngine(): MadelineEngine {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMadelineEngine must be used within MadelineProvider");
  return ctx;
}

/**
 * Tell Madeline what the user has open. Call it from a page with the task,
 * meeting, client or email on screen, or null when nothing is. It clears
 * itself when the page unmounts or the item closes.
 */
export function useMadelineContext(item: Omit<MadelineItem, "path"> | null) {
  const { pathname } = useLocation();
  const key = item ? `${item.kind}:${item.id}:${item.details}` : "";
  useEffect(() => {
    if (!item) return;
    useMadeline.getState().setItem({ ...item, path: pathname });
    return () => {
      const s = useMadeline.getState();
      if (s.item && s.item.kind === item.kind && s.item.id === item.id) s.setItem(null);
    };
    // `key` stands in for `item`, which is a fresh object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pathname]);
}
