import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * The two client channels, seen from the agency side (QA write test WA-03,
 * 23 Nov 2026).
 *
 * The portal could send on both channels from the day 0065 shipped, but no
 * agency screen ever read them, so a client's message or escalation reached
 * nobody. Who may read which channel is decided in the database, not here:
 * can_see_conversation() (0065) lets the client's LEAD EA see the private
 * client_ea channel, and agency leads (owner, admin, manager) see the
 * escalation channel. This file asks for every conversation and RLS returns
 * only the ones this person may see; it never filters by role itself.
 */

export type ConversationKind = "client_ea" | "escalation";

export interface ClientConversation {
  id: string;
  kind: ConversationKind;
  client_id: string;
  client_name: string;
}

export interface ClientMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  sent_at: string;
}

export const CLIENT_CONVERSATIONS_KEY = ["client-conversations"] as const;
export const CLIENT_MESSAGES_KEY = ["client-conversation-messages"] as const;

export function useClientConversations() {
  return useQuery<ClientConversation[]>({
    queryKey: CLIENT_CONVERSATIONS_KEY,
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("conversations")
        .select("id, kind, client_id, clients(name)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as { id: string; kind: ConversationKind; client_id: string; clients: { name: string } | null }[])
        .map((c) => ({ id: c.id, kind: c.kind, client_id: c.client_id, client_name: c.clients?.name ?? "Client" }));
    },
    refetchInterval: 120_000,
  });
}

/** The latest messages across every conversation this person can see. */
export function useClientMessages() {
  return useQuery<ClientMessage[]>({
    queryKey: CLIENT_MESSAGES_KEY,
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("conversation_messages")
        .select("id, conversation_id, sender_id, body, sent_at")
        .order("sent_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ClientMessage[];
    },
    refetchInterval: 60_000,
  });
}

export function useSendClientMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, body }: { conversationId: string; body: string }) => {
      if (!supabase) throw new Error("Not available in the demo.");
      const text = body.trim();
      if (!text) throw new Error("Write a message first.");
      // sender_id defaults to auth.uid(), and the insert policy requires it.
      const { error } = await supabase.from("conversation_messages").insert({ conversation_id: conversationId, body: text });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CLIENT_MESSAGES_KEY }),
  });
}

/* Per-browser "seen up to" marks, so the list and the bell can say what is new.
   Kept locally like the bell's own read marks: it is a convenience, and the
   messages themselves are the record. */
const SEEN_KEY = "madeea-client-messages-seen";

export function loadSeen(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; }
}

export function markSeen(conversationId: string, at: string) {
  try {
    const seen = loadSeen();
    if (!seen[conversationId] || seen[conversationId] < at) {
      seen[conversationId] = at;
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      window.dispatchEvent(new Event("client-messages-seen"));
    }
  } catch { /* storage blocked: unread marks just do not persist */ }
}

export const CHANNEL_LABEL: Record<ConversationKind, { short: string; long: string }> = {
  client_ea: { short: "Private", long: "Private: the client and their lead EA" },
  escalation: { short: "Escalation", long: "Escalation: the client and agency leads" },
};
