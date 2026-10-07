import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { assistantChatReply, type ChatMessage } from "@/lib/ai";
import { renderMarkdown } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

/**
 * Madeline in the client portal.
 *
 * The same assistant the agency uses, in client mode: the server sees a
 * client login and answers only from that client's own account (its tasks,
 * meetings, hours and shared notes; see assistant-chat, CLIENT MODE). Nothing
 * here can widen that.
 *
 * Read-only, like the agency side. When the client asks for something,
 * Madeline proposes it as a request card; it goes to their assistant only when
 * "Send request" is pressed (client_create_task). View-only colleagues get the
 * answers without the card.
 *
 * The thread lives in this browser tab (sessionStorage), keyed to the person.
 */

interface Turn {
  id: string;
  prompt: string;
  status: "running" | "done" | "error";
  reply?: string;
  sources?: { kind: string; count: number }[];
  sent?: boolean;
}

interface Proposal { title: string; due: string | null }

const SOURCE: Record<string, [string, string]> = {
  tasks: ["task", "tasks"], meetings: ["meeting", "calendar"], hours: ["day of hours", "activity"], notes: ["note", "notes"],
};

/** Pull the ```request block out of a reply. A malformed block means no card. */
function parse(reply: string): { text: string; proposal: Proposal | null } {
  const m = /```request\s*\n([\s\S]*?)```/.exec(reply);
  if (!m) return { text: reply, proposal: null };
  const text = reply.replace(m[0], "").trim();
  try {
    const raw = JSON.parse(m[1]) as { title?: unknown; due?: unknown };
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
    if (!title) return { text, proposal: null };
    return { text, proposal: { title, due: typeof raw.due === "string" && raw.due.trim() ? raw.due.trim().slice(0, 60) : null } };
  } catch {
    return { text, proposal: null };
  }
}

/** member: a client's own staff (0078). Madeline reads only their own work, and proposes no requests. */
export function ClientMadeline({ readOnly: readOnlyProp = false, member = false, onNavigate }: { readOnly?: boolean; member?: boolean; onNavigate?: (tab: string) => void }) {
  const readOnly = readOnlyProp || member;
  const { user } = useAuth();
  const key = `madeea-client-madeline-${user?.id ?? "anon"}`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => {
    try { return (JSON.parse(sessionStorage.getItem(key) ?? "[]") as Turn[]).map((t) => (t.status === "running" ? { ...t, status: "error", reply: "Interrupted. Ask again." } : t)); }
    catch { return []; }
  });
  const running = turns.some((t) => t.status === "running");
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(turns.slice(-30))); } catch { /* storage blocked */ } }, [turns, key]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [turns, open]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const starters = useMemo(() => member ? [
    "What's on my plate today?",
    "What did I finish this week?",
    "How many hours have I worked this week?",
    "Help me write my daily report",
  ] : [
    "What did my assistant do this week?",
    "What's waiting on me?",
    "What's coming up?",
    ...(readOnly ? [] : ["Help me write a request"]),
  ], [readOnly, member]);

  function ask(prompt: string) {
    const raw = prompt.trim();
    if (!raw || running) return;
    const id = `t-${Date.now()}`;
    const history: ChatMessage[] = [];
    for (const t of turns.slice(-8)) {
      if (t.status !== "done" || !t.reply) continue;
      history.push({ role: "user", content: t.prompt }, { role: "assistant", content: t.reply });
    }
    history.push({ role: "user", content: raw });
    setTurns((ts) => [...ts, { id, prompt: raw, status: "running" }]);
    setDraft("");
    assistantChatReply(history, { page: "Client portal" })
      .then(({ reply, sources }) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: "done", reply: reply || "I couldn't come up with an answer to that. Try asking another way.", sources } : t))))
      .catch((e) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: "error", reply: e instanceof Error ? e.message : String(e) } : t))));
  }

  async function sendRequest(turnId: string, p: Proposal) {
    if (!supabase) return;
    const { error } = await supabase.rpc("client_create_task", { p_title: p.title, p_due_label: p.due });
    if (error) {
      setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, reply: `${t.reply}\n\n_Couldn't send the request: ${error.message}_` } : t)));
      return;
    }
    setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, sent: true } : t)));
    void qc.invalidateQueries({ queryKey: ["client-portal"] });
  }

  const first = user?.name?.split(" ")[0];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask Madeline"
        title="Ask Madeline about your account"
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.02] sm:px-3"
      >
        <Sparkles size={16} /> <span className="hidden sm:inline">Ask Madeline</span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[70] bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside
            aria-label="Madeline"
            className="fixed right-0 top-0 z-[71] flex h-full w-full flex-col border-l border-border p-4 backdrop-blur-lg sm:w-[400px]"
            style={{ background: "var(--glass)", animation: "slideInChip 0.3s cubic-bezier(0.22,1,0.36,1)" }}
          >
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <span className="madeline-orb madeline-orb-still h-9 w-9 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold tracking-tight">Madeline</p>
                <p className="truncate text-xs text-faint">Your MadeEA assistant</p>
              </div>
              {turns.length > 0 && (
                <button onClick={() => setTurns([])} aria-label="Start a new conversation" title="New conversation"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-[var(--chip-bg)] hover:text-text">
                  <RotateCcw size={16} />
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close Madeline"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-[var(--chip-bg)] hover:text-text">
                <X size={18} />
              </button>
            </div>

            <div ref={scroll} className="flex flex-1 flex-col gap-3 overflow-y-auto py-3 pr-1" aria-live="polite">
              {turns.length === 0 && (
                <div className="flex flex-col gap-3">
                  <p className="text-lg font-extrabold">Hi{first ? ` ${first}` : ""}.</p>
                  <p className="text-[13px] text-muted">
                    {member
                      ? "I can see your own tasks, your hours, the account's meetings and its shared notes. Ask me what's next, or to draft your daily report."
                      : <>I can see your tasks, meetings, hours and the notes you share with your assistant. Ask me where things stand
                        {readOnly ? "." : ", or tell me what you need and I'll turn it into a request."}</>}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {starters.map((s) => (
                      <button key={s} onClick={() => ask(s)} disabled={running}
                        className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:border-accent hover:text-accent disabled:opacity-40">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((t) => <TurnView key={t.id} turn={t} readOnly={readOnly} onSend={sendRequest} onNavigate={(tab) => { setOpen(false); onNavigate?.(tab); }} />)}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); ask(draft); }}
              className="flex items-end gap-2 rounded-2xl border border-border py-1.5 pl-3.5 pr-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40"
              style={{ background: "var(--glass-2)" }}
            >
              <textarea
                ref={input}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(draft); } }}
                placeholder={member ? "Ask about your work…" : "Ask about your account…"}
                aria-label="Message Madeline"
                className="min-w-0 flex-1 resize-none bg-transparent py-2 text-[13px] leading-snug text-text outline-none placeholder:text-faint focus-visible:outline-none"
              />
              <button type="submit" disabled={running || !draft.trim()} aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white disabled:opacity-40">
                <ArrowUp size={18} />
              </button>
            </form>
          </aside>
        </>,
        document.body,
      )}
    </>
  );
}

function TurnView({ turn, readOnly, onSend, onNavigate }: {
  turn: Turn; readOnly: boolean;
  onSend: (id: string, p: Proposal) => void;
  onNavigate: (tab: string) => void;
}) {
  const { text, proposal } = useMemo(() => parse(turn.reply ?? ""), [turn.reply]);
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <>
      <div className="max-w-[88%] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-accent px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
        {turn.prompt}
      </div>
      {turn.status === "running" ? (
        <div className="self-start rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3 py-2.5">
          <span className="cc-typing" aria-label="Madeline is thinking"><span /><span /><span /></span>
        </div>
      ) : (
        <div className={cn("max-w-[92%] self-start rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed", turn.status === "error" && "text-red-400")}>
          {turn.status === "error" ? turn.reply : <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      )}
      {proposal && !readOnly && (
        <div className="max-w-[92%] self-start rounded-xl border border-accent/40 bg-accent/5 p-3 text-[13px]">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Request for your assistant</p>
          <p className="mt-1 font-bold leading-snug">{proposal.title}</p>
          {proposal.due && <p className="mt-0.5 text-xs text-muted">When: {proposal.due}</p>}
          {turn.sent ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs font-bold text-emerald-400"><Check size={13} /> Sent to your assistant</p>
          ) : (
            <button onClick={() => onSend(turn.id, proposal)}
              className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white">
              <Send size={13} /> Send request
            </button>
          )}
        </div>
      )}
      {turn.status === "done" && (turn.sources?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5 self-start">
          {turn.sources!.filter((s) => SOURCE[s.kind]).map((s) => {
            const [word, tab] = SOURCE[s.kind];
            return (
              <button key={s.kind} onClick={() => onNavigate(tab)}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted hover:border-accent hover:text-accent">
                {s.count} {word}{s.count === 1 ? "" : "s"}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
