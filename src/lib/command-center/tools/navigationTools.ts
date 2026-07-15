/**
 * Navigation tools — open pages / settings by natural-language target.
 * Resolves against the app's NAV table plus a few aliases so "open my clients"
 * or "take me to email" land on the right route.
 */
import { Compass, Settings } from "lucide-react";
import type { Tool, ToolResult } from "../types";
import { NAV } from "@/lib/constants";

// Extra routes not in the sidebar NAV, plus friendly aliases → path.
const ALIASES: Record<string, string> = {
  home: "/",
  dashboard: "/",
  tasks: "/tasks",
  "task manager": "/tasks",
  todos: "/tasks",
  communication: "/communication",
  inbox: "/communication",
  email: "/communication",
  emails: "/communication",
  messages: "/communication",
  "quick actions": "/quick-actions",
  clients: "/clients",
  "client vault": "/clients",
  sops: "/sops",
  playbooks: "/sops",
  automation: "/automation",
  automations: "/automation",
  integrations: "/integrations",
  studio: "/studio",
  "communication studio": "/studio",
  bookkeeping: "/bookkeeping",
  finance: "/bookkeeping",
  settings: "/settings",
  admin: "/admin",
  "admin panel": "/admin",
  changelog: "/changelog",
};

function resolvePath(target: string): { path: string; label: string } | null {
  const t = target.trim().toLowerCase();
  if (!t) return null;
  // Exact NAV label match first, then alias table, then substring on NAV labels.
  const nav = NAV.find((n) => n.label.toLowerCase() === t);
  if (nav) return { path: nav.to, label: nav.label };
  for (const [key, path] of Object.entries(ALIASES)) {
    if (t === key || t.includes(key) || key.includes(t)) {
      const named = NAV.find((n) => n.to === path);
      return { path, label: named?.label ?? key.replace(/\b\w/g, (c) => c.toUpperCase()) };
    }
  }
  const partial = NAV.find((n) => n.label.toLowerCase().includes(t));
  return partial ? { path: partial.to, label: partial.label } : null;
}

export const NavigationTool: Tool = {
  name: "Open Page",
  intent: "open_page",
  category: "navigate",
  description: "Jump to any page in the app.",
  icon: Compass,
  permissions: "safe",
  validate: (ctx) => (ctx.params.target?.trim() ? null : "Which page do you want to open?"),
  execute: async (ctx): Promise<ToolResult> => {
    const resolved = resolvePath(ctx.params.target);
    if (!resolved) return { kind: "error", message: `I couldn't find a page called “${ctx.params.target}”.` };
    ctx.navigate(resolved.path);
    return { kind: "navigate", path: resolved.path, label: resolved.label };
  },
};

export const OpenSettingsTool: Tool = {
  name: "Open Settings",
  intent: "open_settings",
  category: "navigate",
  description: "Open your settings.",
  icon: Settings,
  permissions: "safe",
  validate: () => null,
  execute: async (ctx): Promise<ToolResult> => {
    ctx.navigate("/settings");
    return { kind: "navigate", path: "/settings", label: "Settings" };
  },
};
