/**
 * Permission manager — centralizes the "is this action high-risk?" decision so
 * the confirmation policy lives in one place rather than being scattered across
 * tools. Today risk is a static property on the tool (`permissions`), but this
 * indirection lets future logic (per-workspace roles, destructive-by-params,
 * user setting) gate execution without changing callers.
 */
import type { Tool, ToolContext } from "./types";

/** Verbs that imply an irreversible / outward-facing action. */
const DESTRUCTIVE = /\b(send|delete|remove|archive|wipe|clear all|cancel|unsubscribe)\b/i;

export function requiresConfirmation(tool: Tool, ctx: ToolContext): boolean {
  // Static policy on the tool, OR a destructive verb in the raw prompt (so
  // "send an email to my client" confirms while "write an email" doesn't).
  return tool.permissions === "confirm" || DESTRUCTIVE.test(ctx.command.raw);
}

export function confirmationLabel(tool: Tool, ctx: ToolContext): string {
  if (tool.confirmLabel) return tool.confirmLabel(ctx);
  const verb = ctx.command.raw.match(DESTRUCTIVE)?.[0]?.toLowerCase();
  if (verb) return `You asked to ${verb} — confirm to proceed with “${tool.name}”.`;
  return `Run “${tool.name}”? This action can’t be undone automatically.`;
}
