/**
 * AI Command Center — shared types.
 *
 * Architectural note: the Command Center is built around a *tool-calling* core.
 * A user's natural-language prompt is classified into an `Intent` + `params` by
 * the intent parser, the router looks up the matching `Tool` in the registry,
 * and the tool's `execute()` runs against a `ToolContext` (data, mutations,
 * navigation, AI, stores) assembled by the React layer. New capabilities are
 * added by registering a new Tool — no core code changes. See ./toolRegistry.
 */
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/** Every capability the Command Center understands. Each maps to exactly one tool. */
export type Intent =
  | "create_project"
  | "create_task"
  | "create_note"
  | "create_meeting_notes"
  | "create_reminder"
  | "summarize_documents"
  | "summarize_pdf"
  | "analyze_document"
  | "write_email"
  | "rewrite_text"
  | "translate"
  | "explain"
  | "generate_code"
  | "search_workspace"
  | "search_files"
  | "search_projects"
  | "search_notes"
  | "open_page"
  | "open_settings"
  | "ask" // free-form conversational fallback
  | "unknown";

/** Result of classifying a raw prompt. */
export interface ParsedCommand {
  intent: Intent;
  /** Extracted, tool-specific parameters (e.g. `{ title: "Marketing Campaign" }`). */
  params: Record<string, string>;
  /** 0–1 confidence from the parser; low confidence falls back to `ask`. */
  confidence: number;
  /** The original prompt, verbatim. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type PermissionLevel = "safe" | "confirm";

/** Category used purely for grouping/badging in the UI. */
export type ToolCategory = "create" | "search" | "generate" | "navigate";

/** Discriminated result payload the UI knows how to render (see ResultCard). */
export type ToolResult =
  | { kind: "text"; title?: string; markdown: string }
  | { kind: "entity"; title: string; subtitle?: string; entity: SearchResult["type"]; path?: string }
  | { kind: "search"; results: SearchResult[]; query: string }
  | { kind: "navigate"; path: string; label: string }
  | { kind: "created"; title: string; detail?: string; path?: string }
  | { kind: "error"; message: string };

/** Runtime services a tool may use. Assembled by useCommandCenter each render. */
export interface ToolContext {
  params: Record<string, string>;
  /** Full parse (intent + confidence + raw) for tools that want more than params. */
  command: ParsedCommand;
  /** Conversation so far, oldest→newest, for context-aware generation. */
  conversation: ConversationMessage[];
  navigate: (path: string) => void;
  /** Server-side AI (real in live mode, labelled demo fallback otherwise). */
  ai: {
    generate: (format: string, inputs: Record<string, string>) => Promise<string>;
    chat: (messages: ConversationMessage[]) => Promise<string>;
  };
  /** Local + live data access and writes. See useCommandCenter for wiring. */
  workspace: WorkspaceApi;
}

/**
 * The Tool contract. Every action implements this. `validate` gates execution
 * with a friendly message; `permissions` marks high-risk tools that require a
 * confirmation step before `execute` runs.
 */
export interface Tool {
  name: string;
  intent: Intent;
  category: ToolCategory;
  description: string;
  icon: LucideIcon;
  permissions: PermissionLevel;
  /** Human-readable confirmation prompt, required when permissions === "confirm". */
  confirmLabel?: (ctx: ToolContext) => string;
  /** Return an error string to block execution, or null when the input is valid. */
  validate: (ctx: ToolContext) => string | null;
  execute: (ctx: ToolContext) => Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/** One rendered turn in the Command Center transcript. */
export interface Turn {
  id: string;
  prompt: string;
  intent: Intent;
  status: "running" | "success" | "error";
  /** Present once execution resolves. */
  result?: ToolResult;
  /** Progress line shown by ToolExecution while running. */
  progress?: string;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SearchEntity =
  | "project"
  | "note"
  | "task"
  | "client"
  | "message"
  | "sop"
  | "meeting"
  | "automation"
  | "generation"
  | "page";

export interface SearchResult {
  id: string;
  type: SearchEntity;
  label: string;
  sub?: string;
  path: string;
  /** Lower = more relevant. */
  score: number;
}

// ---------------------------------------------------------------------------
// Suggestions & history
// ---------------------------------------------------------------------------

export interface Suggestion {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Prompt inserted/run when the suggestion is chosen. */
  prompt: string;
  hint?: string;
}

export interface CommandHistoryEntry {
  id: string;
  prompt: string;
  intent: Intent;
  at: number;
  count: number;
  pinned: boolean;
}

// ---------------------------------------------------------------------------
// Workspace (local-first entities + bridges to live data)
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  projectId?: string;
  createdAt: number;
}

export interface LocalTask {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
}

export interface LocalReminder {
  id: string;
  label: string;
  remindAt: string;
  createdAt: number;
}

/**
 * Unified data surface the tools write/read through. Concrete implementation
 * lives in useCommandCenter, which routes writes to Supabase when configured
 * and always mirrors them into local zustand stores so the demo (empty seed,
 * no-op mutations) stays fully functional and searchable.
 */
export interface WorkspaceApi {
  createProject: (title: string, description?: string) => Project;
  createNote: (title: string, body: string, projectId?: string) => Note;
  createTask: (title: string) => Promise<LocalTask>;
  createReminder: (label: string, remindAt: string) => Promise<LocalReminder>;
  /** Everything searchable, already normalized to SearchResult candidates. */
  searchIndex: () => Omit<SearchResult, "score">[];
}
