import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Lock, MessagesSquare, Send, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useWorkspaceMembers } from "@/data/hooks";
import {
  CHANNEL_LABEL, loadSeen, markSeen, useClientConversations, useClientMessages, useSendClientMessage,
  type ClientConversation,
} from "@/data/clientMessages";
import { cn } from "@/lib/utils";

/**
 * Client messages: the agency side of the portal's two channels (QA write
 * test WA-03, 23 Nov 2026). Until this page a client's message to their
 * assistant, or an escalation to "Agency leadership", was saved and then read
 * by nobody.
 *
 * Each person sees only what the database lets them see (0065): a lead EA, the
 * private channel of the clients they lead; owners, admins and managers, the
 * escalation channel. Neither side reads the other's, on purpose: a client
 * raising a problem about their assistant must not be writing where that
 * assistant reads, and the private channel is private from management.
 */
export default function ClientMessages() {
  const { data: convs = [], isLoading: convLoading, error: convError } = useClientConversations();
  const { data: messages = [], isLoading: msgLoading } = useClientMessages();
  const { data: members = [] } = useWorkspaceMembers();
  const send = useSendClientMessage();
  const [params, setParams] = useSearchParams();
  const [seen, setSeen] = useState(loadSeen);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setSeen(loadSeen());
    window.addEventListener("client-messages-seen", on);
    return () => window.removeEventListener("client-messages-seen", on);
  }, []);

  const memberName = useMemo(() => new Map(members.map((m) => [m.user_id, m.is_me ? "You" : m.name])), [members]);
  const me = members.find((m) => m.is_me)?.user_id;

  /* Newest activity first, then client name. A conversation with nothing in it
     still shows, so the agency can start one. */
  const rows = useMemo(() => {
    const last = new Map<string, { sent_at: string; body: string; sender_id: string | null }>();
    for (const m of messages) if (!last.has(m.conversation_id)) last.set(m.conversation_id, m);
    return convs
      .map((c) => {
        const l = last.get(c.id);
        const unread = messages.filter(
          (m) => m.conversation_id === c.id && m.sender_id !== me && (!seen[c.id] || m.sent_at > seen[c.id]),
        ).length;
        return { c, last: l, unread };
      })
      .sort((a, b) => (b.last?.sent_at ?? "").localeCompare(a.last?.sent_at ?? "") || a.c.client_name.localeCompare(b.c.client_name));
  }, [convs, messages, seen, me]);

  const selectedId = params.get("c") ?? rows[0]?.c.id ?? null;
  const selected: ClientConversation | undefined = convs.find((c) => c.id === selectedId);
  const thread = useMemo(
    () => messages.filter((m) => m.conversation_id === selectedId).slice().reverse(),
    [messages, selectedId],
  );

  // Opening a conversation marks it read, up to its newest message.
  useEffect(() => {
    if (selectedId && thread.length) markSeen(selectedId, thread[thread.length - 1].sent_at);
    endRef.current?.scrollIntoView({ block: "end" });
  }, [selectedId, thread]);

  function who(senderId: string | null, conv: ClientConversation) {
    if (!senderId) return "Former user";
    return memberName.get(senderId) ?? conv.client_name;
  }

  async function submit() {
    if (!selected || !draft.trim()) return;
    setError("");
    try {
      await send.mutateAsync({ conversationId: selected.id, body: draft });
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send. Try again.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Client messages"
        subtitle="Messages from your clients' portals. You see the private channel for the clients you lead; agency leads see escalations."
      />

      {convError ? (
        <p className="card flex items-center gap-2 p-4 text-sm text-red-400"><AlertTriangle size={15} /> Couldn't load client messages. Reload to try again.</p>
      ) : convLoading || msgLoading ? (
        <p className="text-sm text-faint">Loading client messages…</p>
      ) : convs.length === 0 ? (
        <div className="card p-8 text-center">
          <MessagesSquare size={24} className="mx-auto mb-3 text-faint" />
          <p className="font-medium">No client conversations for you</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-faint">
            You'll see a client's private channel here once you are their lead EA (set in Client Vault), and escalations if you are an owner, admin or manager.
          </p>
        </div>
      ) : (
        <div className="card grid min-h-[480px] overflow-hidden md:grid-cols-[300px_1fr]">
          <ul className="max-h-[70vh] overflow-y-auto border-b border-border md:border-b-0 md:border-r" aria-label="Conversations">
            {rows.map(({ c, last, unread }) => (
              <li key={c.id}>
                <button
                  onClick={() => setParams({ c: c.id }, { replace: true })}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-[var(--chip-bg)]",
                    c.id === selectedId && "bg-[var(--chip-bg)]",
                  )}
                >
                  <span className={cn("mt-0.5 shrink-0", c.kind === "escalation" ? "text-amber-400" : "text-accent")}>
                    {c.kind === "escalation" ? <ShieldAlert size={16} /> : <Lock size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.client_name}</span>
                      <span className="pill shrink-0 bg-surface-2 text-[10px] text-faint">{CHANNEL_LABEL[c.kind].short}</span>
                      {unread > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">{last ? last.body : "No messages yet"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <section className="flex min-h-0 flex-col" aria-label={`${selected.client_name}, ${CHANNEL_LABEL[selected.kind].long}`}>
              <header className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">{selected.client_name}</p>
                <p className="text-xs text-faint">{CHANNEL_LABEL[selected.kind].long}</p>
              </header>
              <div className="max-h-[56vh] flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {thread.length === 0 ? (
                  <p className="py-10 text-center text-sm text-faint">No messages yet. Anything you send appears in {selected.client_name}'s portal.</p>
                ) : thread.map((m) => {
                  const mine = m.sender_id === me;
                  return (
                    <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-accent text-white" : "bg-surface-2")}>
                        <p className={cn("mb-0.5 text-[11px] font-medium", mine ? "text-white/80" : "text-faint")}>
                          {who(m.sender_id, selected)} · {new Date(m.sent_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              {error && <p className="px-4 pb-2 text-sm text-red-400">{error}</p>}
              <form
                className="flex items-end gap-2 border-t border-border p-3 pr-20 sm:pr-24"
                onSubmit={(e) => { e.preventDefault(); void submit(); }}
              >
                <label htmlFor="client-msg-draft" className="sr-only">Reply to {selected.client_name}</label>
                <textarea
                  id="client-msg-draft"
                  className="input min-w-0 flex-1 resize-none"
                  rows={2}
                  maxLength={4000}
                  placeholder={`Reply to ${selected.client_name}…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
                />
                <button type="submit" className="btn-primary h-11" disabled={!draft.trim() || send.isPending} aria-label="Send reply">
                  <Send size={15} /> Send
                </button>
              </form>
            </section>
          ) : (
            <p className="p-8 text-sm text-faint">Pick a conversation.</p>
          )}
        </div>
      )}
    </div>
  );
}
