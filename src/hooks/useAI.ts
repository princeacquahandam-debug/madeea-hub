/**
 * useAI — thin adapter over lib/ai.ts that gives the Command Center a stable
 * `{ generate, chat }` surface (matching ToolContext.ai). Keeping the model
 * calls behind this hook means tools never import the transport directly, so
 * the backend (Supabase edge fn today; a different provider tomorrow) can change
 * in one place. `configured` reflects whether real AI is wired vs demo fallback.
 */
import { useMemo } from "react";
import { generate as aiGenerate, assistantChat } from "@/lib/ai";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { ConversationMessage } from "@/lib/command-center/types";

export function useAI() {
  return useMemo(
    () => ({
      configured: isSupabaseConfigured,
      generate: (format: string, inputs: Record<string, string>) =>
        aiGenerate({ tool: "studio", format, inputs }),
      chat: (messages: ConversationMessage[]) => assistantChat(messages),
    }),
    [],
  );
}
