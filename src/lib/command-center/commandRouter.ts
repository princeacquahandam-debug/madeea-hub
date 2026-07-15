/**
 * Command router — turns a ParsedCommand into an executable decision.
 *
 * Two phases keep UI concerns (confirmation dialogs) out of the tools:
 *   1. `route(parsed, ctx)` resolves the tool, runs `validate`, and reports
 *      whether it is ready, needs confirmation, or is invalid.
 *   2. `runTool(tool, ctx)` executes and normalizes any thrown error into a
 *      `{ kind: "error" }` result so the caller never has to try/catch.
 *
 * The orchestrator (useCommandCenter) drives these: it shows a confirm dialog
 * for `needs_confirm`, then calls `runTool`.
 */
import type { ParsedCommand, Tool, ToolContext, ToolResult } from "./types";
import { getTool } from "./toolRegistry";
import { requiresConfirmation, confirmationLabel } from "./permissionManager";

export type RouteDecision =
  | { status: "invalid"; message: string }
  | { status: "ready"; tool: Tool }
  | { status: "needs_confirm"; tool: Tool; label: string };

export function route(parsed: ParsedCommand, ctx: ToolContext): RouteDecision {
  const tool = getTool(parsed.intent);
  if (!tool) {
    return { status: "invalid", message: `No handler is registered for “${parsed.intent}”.` };
  }
  const validationError = tool.validate(ctx);
  if (validationError) {
    return { status: "invalid", message: validationError };
  }
  if (requiresConfirmation(tool, ctx)) {
    return { status: "needs_confirm", tool, label: confirmationLabel(tool, ctx) };
  }
  return { status: "ready", tool };
}

export async function runTool(tool: Tool, ctx: ToolContext): Promise<ToolResult> {
  try {
    return await tool.execute(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong running that command.";
    return { kind: "error", message };
  }
}
