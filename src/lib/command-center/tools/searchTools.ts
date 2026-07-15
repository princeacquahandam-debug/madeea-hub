/**
 * Search-family tools. All share the same ranker (../search) over the workspace
 * index assembled in useCommandCenter (react-query data + local stores). Each
 * scoped variant just constrains the entity type.
 */
import { Search, FolderSearch, NotebookText, FileSearch } from "lucide-react";
import type { SearchEntity, Tool, ToolContext, ToolResult } from "../types";
import { searchWorkspace } from "../search";

function runSearch(ctx: ToolContext, scope?: SearchEntity): ToolResult {
  const query = (ctx.params.query || ctx.command.raw).trim();
  const results = searchWorkspace(query, ctx.workspace.searchIndex(), { scope, limit: 20 });
  return { kind: "search", results, query };
}

export const SearchWorkspaceTool: Tool = {
  name: "Search Workspace",
  intent: "search_workspace",
  category: "search",
  description: "Search across projects, tasks, notes, clients, files, and more.",
  icon: Search,
  permissions: "safe",
  validate: () => null,
  execute: async (ctx) => runSearch(ctx),
};

export const SearchProjectsTool: Tool = {
  name: "Search Projects",
  intent: "search_projects",
  category: "search",
  description: "Find projects by name.",
  icon: FolderSearch,
  permissions: "safe",
  validate: () => null,
  execute: async (ctx) => runSearch(ctx, "project"),
};

export const SearchNotesTool: Tool = {
  name: "Search Notes",
  intent: "search_notes",
  category: "search",
  description: "Find notes.",
  icon: NotebookText,
  permissions: "safe",
  validate: () => null,
  execute: async (ctx) => runSearch(ctx, "note"),
};

export const SearchFilesTool: Tool = {
  name: "Search Files",
  intent: "search_files",
  category: "search",
  description: "Find files, documents, and invoices.",
  icon: FileSearch,
  permissions: "safe",
  validate: () => null,
  // "files" in this app surface as messages/generations/documents; no dedicated
  // scope, so search broadly and let ranking surface the closest matches.
  execute: async (ctx) => runSearch(ctx),
};
