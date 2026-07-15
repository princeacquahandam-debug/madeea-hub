# AI Command Center

The flagship "tell it what you want" surface for MadeEA Hub. Opens with **Ctrl/⌘-K**
(or the **Ask AI** button in the top bar) and turns natural language into actions:
create projects/tasks/notes, draft emails, summarize documents, search the whole
workspace, navigate, and more.

## Architecture at a glance

```
prompt ──▶ intentParser ──▶ commandRouter ──▶ tool.execute(ToolContext) ──▶ ToolResult ──▶ UI
                │                  │                     │
         { intent, params }   permissionManager     toolRegistry
                                (confirm gate)     (extensibility seam)
```

- **`intentParser.ts`** — offline heuristic that classifies a prompt into an
  `Intent` + `params`. Single place mapping language → intent; an AI classifier
  can replace the body behind `parseIntent()` unchanged.
- **`toolRegistry.ts`** — `registerTool()` / `getTool()`. The router only knows
  intents, so adding a capability never touches the router.
- **`commandRouter.ts`** — resolves the tool, runs `validate`, decides
  ready / needs-confirm / invalid, then `runTool` (error-safe).
- **`permissionManager.ts`** — high-risk gate. Confirms on a tool's static
  `permissions: "confirm"` or a destructive verb (send/delete/archive…).
- **`conversationMemory.ts`** — rolling window + last result, so "write an email
  about **that**" resolves across turns.
- **`search.ts`** — tiny ranker over an in-memory index (react-query data + local
  stores) for instant search-as-you-type.
- **`tools/`** — one Tool per capability (create / generate / search / navigate).

## Folder map (adapted to the app's conventions)

| Spec folder | Here |
|---|---|
| `/utils` | `src/lib/command-center/*` (parser, router, registry, memory, permissions, search) |
| `/tools` | `src/lib/command-center/tools/*` |
| `/hooks` | `src/hooks/useCommandCenter.tsx`, `useAI.ts`, `useCommandHistory.ts` |
| `/components` | `src/components/command-center/*` |
| stores | `src/store/workspace.ts`, `src/store/commandHistory.ts` |

## Add a new tool (no core changes)

```ts
import { registerTool } from "@/lib/command-center/tools";
import { FileText } from "lucide-react";

registerTool({
  name: "Create Invoice",
  intent: "create_invoice",      // add to Intent union in types.ts
  category: "create",
  description: "Draft an invoice.",
  icon: FileText,
  permissions: "confirm",         // gate high-risk actions
  validate: (ctx) => (ctx.params.amount ? null : "How much?"),
  execute: async (ctx) => ({ kind: "created", title: "Invoice drafted" }),
});
```

Then add a matcher for `create_invoice` in `intentParser.ts`. That's it.

## Demo vs live

Writes go to local zustand stores (instant, works in the static demo) **and**
through the live Supabase mutations when configured. AI runs through
`lib/ai.ts` — real model in live mode, a labelled fallback in demo.

## Future-ready

Voice input (placeholder button reserved), plugin/custom tools (registry),
multi-step agents, document chat, and a persistent memory system all slot in
behind the existing seams.
