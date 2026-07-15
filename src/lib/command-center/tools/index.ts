/**
 * Tool registration entrypoint. Importing this module (done once, from
 * useCommandCenter) registers every built-in tool. To add a capability, create
 * a Tool and add it to BUILTIN_TOOLS — nothing else changes.
 *
 * `registerTool` (re-exported) is also the public API for runtime/plugin tools:
 *   registerTool({ name: "Create Invoice", intent: "create_invoice", ... })
 */
import { registerTool } from "../toolRegistry";
import type { Tool } from "../types";
import { CreateProjectTool, CreateTaskTool, CreateNoteTool, ReminderTool } from "./createTools";
import {
  EmailTool, SummaryTool, SummarizePdfTool, AnalyzeDocumentTool, RewriteTool,
  TranslateTool, ExplainTool, CodeTool, MeetingNotesTool, AskTool,
} from "./aiTools";
import { SearchWorkspaceTool, SearchProjectsTool, SearchNotesTool, SearchFilesTool } from "./searchTools";
import { NavigationTool, OpenSettingsTool } from "./navigationTools";

export const BUILTIN_TOOLS: Tool[] = [
  // create
  CreateProjectTool, CreateTaskTool, CreateNoteTool, ReminderTool,
  // generate
  EmailTool, SummaryTool, SummarizePdfTool, AnalyzeDocumentTool, RewriteTool,
  TranslateTool, ExplainTool, CodeTool, MeetingNotesTool, AskTool,
  // search
  SearchWorkspaceTool, SearchProjectsTool, SearchNotesTool, SearchFilesTool,
  // navigate
  NavigationTool, OpenSettingsTool,
];

let registered = false;

/** Idempotently register all built-in tools. Safe to call on every mount. */
export function registerBuiltinTools(): void {
  if (registered) return;
  BUILTIN_TOOLS.forEach(registerTool);
  registered = true;
}

export { registerTool };
