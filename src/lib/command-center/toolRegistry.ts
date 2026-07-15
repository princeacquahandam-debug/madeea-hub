/**
 * Tool registry — the extensibility seam.
 *
 * Tools register themselves here at import time. The router resolves an intent
 * to a tool purely through this map, so adding a capability is a one-liner
 * (`registerTool({...})`) with zero edits to the router, parser types aside.
 * This is the "no existing code needs modification to add a tool" requirement.
 */
import type { Intent, Tool } from "./types";

const registry = new Map<Intent, Tool>();

/** Register (or override) the tool that handles a given intent. */
export function registerTool(tool: Tool): void {
  if (registry.has(tool.intent) && import.meta.env.DEV) {
    // Non-fatal: last registration wins, but surface accidental collisions.
    console.warn(`[command-center] tool for intent "${tool.intent}" re-registered (${tool.name}).`);
  }
  registry.set(tool.intent, tool);
}

export function getTool(intent: Intent): Tool | undefined {
  return registry.get(intent);
}

export function allTools(): Tool[] {
  return [...registry.values()];
}

export function hasTool(intent: Intent): boolean {
  return registry.has(intent);
}
