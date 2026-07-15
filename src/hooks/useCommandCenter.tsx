/**
 * useCommandCenter — the orchestrator + React context for the AI Command Center.
 *
 * Responsibilities (kept in one place so components stay dumb):
 *  - global open state + Ctrl/⌘-K + Esc
 *  - assembling the ToolContext (data, mutations, navigation, AI, local stores)
 *  - the parse → route → (confirm?) → execute pipeline, tracked as `turns`
 *  - multi-turn conversation memory (so "that" resolves across turns)
 *  - a live, in-memory search index + instant search-as-you-type
 *  - suggested + personalized ("smart") suggestions
 *
 * Data flow rationale: writes go to local zustand stores (instant, demo-proof)
 * AND through the live Supabase mutations when configured, so the feature works
 * identically in the hosted demo and a real deployment.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderPlus, FileText, Mail, CalendarPlus, Search, Sparkles, NotebookText, FileClock, BarChart3,
} from "lucide-react";

import { useClients, useTasks, useMessages, useSops, useMeetings, useAutomations, useTaskMutations, useReminderMutations } from "@/data/hooks";
import { NAV } from "@/lib/constants";
import { useAI } from "@/hooks/useAI";
import { useWorkspace } from "@/store/workspace";
import { useCommandHistory } from "@/store/commandHistory";

import { parseIntent } from "@/lib/command-center/intentParser";
import { route, runTool } from "@/lib/command-center/commandRouter";
import { registerBuiltinTools } from "@/lib/command-center/tools";
import { searchWorkspace } from "@/lib/command-center/search";
import { ConversationMemory } from "@/lib/command-center/conversationMemory";
import { uid } from "@/store/workspace";
import type {
  SearchResult, Suggestion, ToolContext, ToolResult, Turn, WorkspaceApi,
} from "@/lib/command-center/types";

// Register the built-in tools exactly once, at module load.
registerBuiltinTools();

interface PendingConfirm {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface CommandCenterValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  query: string;
  setQuery: (v: string) => void;
  turns: Turn[];
  running: boolean;
  aiConfigured: boolean;
  /** Live search results for the current query (empty query → []). */
  searchResults: SearchResult[];
  suggestions: Suggestion[];
  smartSuggestions: Suggestion[];
  pendingConfirm: PendingConfirm | null;
  /** Run a raw prompt through the full pipeline. */
  submit: (prompt?: string) => void;
  navigate: (path: string) => void;
  clearConversation: () => void;
}

const Ctx = createContext<CommandCenterValue | null>(null);

// Turn category → progress verb shown by the typing indicator.
const PROGRESS: Record<string, string> = { create: "Creating…", generate: "Thinking…", search: "Searching…", navigate: "Opening…" };

/** Compact a tool result into a line of text for conversation memory. */
function resultToText(r: ToolResult): string {
  switch (r.kind) {
    case "text": return r.markdown;
    case "created": return `${r.title}${r.detail ? ` — ${r.detail}` : ""}`;
    case "navigate": return `Opened ${r.label}.`;
    case "search": return `Found ${r.results.length} results for “${r.query}”.`;
    case "entity": return r.title;
    case "error": return r.message;
  }
}

export function CommandCenterProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const ai = useAI();
  const ws = useWorkspace();
  const history = useCommandHistory();
  const taskMutations = useTaskMutations();
  const reminderMutations = useReminderMutations();

  // Live data (react-query). In demo mode these resolve to empty seed arrays.
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: sops = [] } = useSops();
  const { data: meetings = [] } = useMeetings();
  const { data: automations = [] } = useAutomations();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const memory = useRef(new ConversationMemory());

  // ---- global open shortcut (Ctrl/⌘-K) + Esc ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && !pendingConfirm) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingConfirm]);

  // ---- debounce the query feeding search (keeps typing cheap) ----
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 90);
    return () => clearTimeout(id);
  }, [query]);

  // ---- the searchable index, rebuilt when any source changes ----
  const index = useMemo<Omit<SearchResult, "score">[]>(() => {
    const pages = NAV.map((n) => ({ id: `page:${n.to}`, type: "page" as const, label: n.label, sub: n.group, path: n.to }));
    return [
      ...pages,
      ...ws.projects.map((p) => ({ id: p.id, type: "project" as const, label: p.title, sub: "Project", path: "/" })),
      ...ws.notes.map((n) => ({ id: n.id, type: "note" as const, label: n.title, sub: "Note", path: "/" })),
      ...ws.tasks.map((t) => ({ id: t.id, type: "task" as const, label: t.title, sub: t.done ? "Task · done" : "Task", path: "/tasks" })),
      ...tasks.map((t) => ({ id: `t:${t.id}`, type: "task" as const, label: t.title, sub: t.client_name, path: "/tasks" })),
      ...clients.map((c) => ({ id: `c:${c.id}`, type: "client" as const, label: c.name, sub: c.company, path: "/clients" })),
      ...messages.map((m) => ({ id: `m:${m.id}`, type: "message" as const, label: m.subject, sub: m.sender_name, path: "/communication" })),
      ...sops.map((s) => ({ id: `s:${s.id}`, type: "sop" as const, label: s.title, sub: s.category, path: "/sops" })),
      ...meetings.map((m) => ({ id: `mt:${m.id}`, type: "meeting" as const, label: m.title, sub: m.with, path: "/" })),
      ...automations.map((a) => ({ id: `a:${a.id}`, type: "automation" as const, label: a.name, sub: "Automation", path: "/automation" })),
    ];
  }, [ws.projects, ws.notes, ws.tasks, tasks, clients, messages, sops, meetings, automations]);

  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim();
    if (!q) return [];
    // If the input is phrased as a search command ("search my workspace for X"),
    // rank on the extracted term X, not the whole sentence — otherwise the
    // command words drown out real matches.
    const parsed = parseIntent(q);
    const term = parsed.intent.startsWith("search") && parsed.params.query ? parsed.params.query : q;
    return searchWorkspace(term, index, { limit: 8 });
  }, [debouncedQuery, index]);

  // ---- WorkspaceApi handed to tools (local-first + live write-through) ----
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
    searchIndex: () => index,
  }), [ws, taskMutations, reminderMutations, index]);

  const buildContext = useCallback((raw: string): { ctx: ToolContext } => {
    const parsed = parseIntent(raw);
    const ctx: ToolContext = {
      params: parsed.params,
      command: parsed,
      conversation: memory.current.history(),
      navigate,
      ai: { generate: ai.generate, chat: ai.chat },
      workspace,
    };
    return { ctx };
  }, [navigate, ai, workspace]);

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // ---- the pipeline ----
  const submit = useCallback((prompt?: string) => {
    const raw = (prompt ?? query).trim();
    if (!raw) return;

    setQuery("");
    history.record(raw, parseIntent(raw).intent);
    memory.current.add("user", raw);

    const { ctx } = buildContext(raw);
    const parsed = ctx.command;
    const turnId = uid("turn");
    const turn: Turn = { id: turnId, prompt: raw, intent: parsed.intent, status: "running", progress: PROGRESS[getCategory(parsed.intent)] ?? "Working…" };
    setTurns((ts) => [...ts, turn]);
    setRunning(true);

    const finish = async (execCtx: ToolContext, tool: Parameters<typeof runTool>[0]) => {
      const result = await runTool(tool, execCtx);
      memory.current.add("assistant", resultToText(result));
      patchTurn(turnId, { status: result.kind === "error" ? "error" : "success", result, progress: undefined });
      setRunning(false);
    };

    const decision = route(parsed, ctx);
    if (decision.status === "invalid") {
      patchTurn(turnId, { status: "error", result: { kind: "error", message: decision.message }, progress: undefined });
      memory.current.add("assistant", decision.message);
      setRunning(false);
      return;
    }
    if (decision.status === "needs_confirm") {
      patchTurn(turnId, { progress: "Awaiting confirmation" });
      setPendingConfirm({
        label: decision.label,
        onConfirm: () => { setPendingConfirm(null); void finish(ctx, decision.tool); },
        onCancel: () => {
          setPendingConfirm(null);
          patchTurn(turnId, { status: "error", result: { kind: "error", message: "Cancelled." }, progress: undefined });
          setRunning(false);
        },
      });
      return;
    }
    void finish(ctx, decision.tool);
  }, [query, history, buildContext, patchTurn]);

  const clearConversation = useCallback(() => {
    memory.current.clear();
    setTurns([]);
  }, []);

  // reset transient state whenever the modal closes
  useEffect(() => { if (!open) { setQuery(""); setPendingConfirm(null); } }, [open]);

  // ---- suggestions ----
  const suggestions = useMemo<Suggestion[]>(() => [
    { id: "s-project", label: "Create Project", icon: FolderPlus, prompt: "Create a new project called ", hint: "New workspace project" },
    { id: "s-summarize", label: "Summarize Documents", icon: FileText, prompt: "Summarize ", hint: "Condense to key points" },
    { id: "s-email", label: "Write Email", icon: Mail, prompt: "Write a professional email to ", hint: "Draft in any tone" },
    { id: "s-meeting", label: "Schedule Meeting", icon: CalendarPlus, prompt: "Schedule a reminder for tomorrow to ", hint: "Set a reminder" },
    { id: "s-search", label: "Search Workspace", icon: Search, prompt: "Search my workspace for ", hint: "Find anything" },
  ], []);

  const smartSuggestions = useMemo<Suggestion[]>(() => {
    const list: Suggestion[] = [];
    const latestProject = ws.projects[0];
    if (latestProject) list.push({ id: "smart-project", label: `Continue “${latestProject.title}”`, icon: FolderPlus, prompt: `Summarize project ${latestProject.title}`, hint: "Recent project" });
    if (ws.notes.length) list.push({ id: "smart-notes", label: "Recent Notes", icon: NotebookText, prompt: "Search my notes for ", hint: `${ws.notes.length} saved` });
    list.push({ id: "smart-pdf", label: "Summarize Latest PDF", icon: FileClock, prompt: "Summarize the latest PDF ", hint: "Document digest" });
    list.push({ id: "smart-ask", label: "Ask AI", icon: Sparkles, prompt: "", hint: "Anything at all" });
    list.push({ id: "smart-report", label: "Generate Weekly Report", icon: BarChart3, prompt: "Generate a weekly report of ", hint: "Roll up the week" });
    return list;
  }, [ws.projects, ws.notes.length]);

  const value: CommandCenterValue = {
    open, setOpen, query, setQuery, turns, running, aiConfigured: ai.configured,
    searchResults, suggestions, smartSuggestions, pendingConfirm, submit, navigate, clearConversation,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Access the Command Center. Must be used within CommandCenterProvider. */
export function useCommandCenter(): CommandCenterValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCommandCenter must be used within CommandCenterProvider");
  return ctx;
}

// Local mirror of each intent's tool category (avoids importing every tool here
// just to read a label). Kept tiny and colocated with the progress mapping.
function getCategory(intent: string): string {
  if (intent.startsWith("create_")) return "create";
  if (intent.startsWith("search_")) return "search";
  if (intent === "open_page" || intent === "open_settings") return "navigate";
  return "generate";
}
