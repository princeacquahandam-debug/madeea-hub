import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Check, History, Pencil, Plus, Search, Send, Sparkles, SquarePen, Trash2, X } from "lucide-react";
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
 * Chats live in this browser (localStorage), keyed to the person, with a
 * history view (12 Oct 2026, UI review deck slides 10-11).
 */

interface Turn {
  id: string;
  prompt: string;
  status: "running" | "done" | "error";
  reply?: string;
  sources?: { kind: string; count: number }[];
  sent?: boolean;
  /** When it was asked (ISO), shown under the answer. */
  at?: string;
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

/** One saved conversation (12 Oct 2026, UI review deck slide 11). */
interface Chat { id: string; title: string; turns: Turn[]; updatedAt: string }

const MAX_CHATS = 50;
const newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
/** "What's waiting on me?" → the chat's title. */
const titleFor = (turns: Turn[]) => {
  const first = turns.find((t) => t.prompt.trim())?.prompt.trim().replace(/\s+/g, " ") ?? "New chat";
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function groupOf(iso: string): string {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const days = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "Last 7 days" : "Older";
}

/** member: a client's own staff (0078). Madeline reads only their own work, and proposes no requests. */
export function ClientMadeline({ readOnly: readOnlyProp = false, member = false, onNavigate }: { readOnly?: boolean; member?: boolean; onNavigate?: (tab: string) => void }) {
  const readOnly = readOnlyProp || member;
  const { user } = useAuth();
  const key = `madeea-client-madeline-${user?.id ?? "anon"}`;
  const chatsKey = `madeea-client-madeline-chats-${user?.id ?? "anon"}`;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  /* Every chat, kept in this browser per person. A thread saved before chat
     history existed (sessionStorage) becomes the first one. */
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(chatsKey) ?? "[]") as Chat[];
      const legacy = (JSON.parse(sessionStorage.getItem(key) ?? "[]") as Turn[]);
      if (legacy.length && !saved.some((c) => c.turns.some((t) => t.id === legacy[0].id))) {
        saved.unshift({ id: newId(), title: titleFor(legacy), turns: legacy, updatedAt: new Date().toISOString() });
      }
      return saved.map((c) => ({ ...c, turns: c.turns.map((t) => (t.status === "running" ? { ...t, status: "error", reply: "Interrupted. Ask again." } : t)) }));
    } catch { return []; }
  });
  const [currentId, setCurrentId] = useState<string>(() => chats[0]?.id ?? newId());
  const current = chats.find((c) => c.id === currentId);
  const turns = useMemo(() => current?.turns ?? [], [current]);
  const running = turns.some((t) => t.status === "running");
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    try {
      localStorage.setItem(chatsKey, JSON.stringify(chats.slice(0, MAX_CHATS).map((c) => ({ ...c, turns: c.turns.slice(-30) }))));
      sessionStorage.removeItem(key);
    } catch { /* storage blocked */ }
  }, [chats, chatsKey, key]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [turns, open, view]);
  useEffect(() => {
    if (!open) return;
    if (view === "chat") input.current?.focus();
    // Esc steps back from history first, then closes.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (view === "history") setView("chat"); else setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view]);

  /** Change the open chat's turns, saving it to history with a title from its first question. */
  const setTurns = (fn: (ts: Turn[]) => Turn[]) =>
    setChats((cs) => {
      const existing = cs.find((c) => c.id === currentId);
      const nextTurns = fn(existing?.turns ?? []);
      const chat: Chat = {
        id: currentId,
        title: existing && existing.title !== titleFor(existing.turns) ? existing.title : titleFor(nextTurns),
        turns: nextTurns,
        updatedAt: new Date().toISOString(),
      };
      return [chat, ...cs.filter((c) => c.id !== currentId)].slice(0, MAX_CHATS);
    });
  const newChat = () => { setCurrentId(newId()); setView("chat"); setDraft(""); };
  const openChat = (id: string) => { setCurrentId(id); setView("chat"); };
  const deleteChat = (id: string) => {
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === currentId) setCurrentId(newId());
  };
  const renameChat = (id: string, title: string) =>
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c)));

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
    const chatId = currentId;
    const patch = (fn: (t: Turn) => Turn) =>
      setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, turns: c.turns.map((t) => (t.id === id ? fn(t) : t)) } : c)));
    setTurns((ts) => [...ts, { id, prompt: raw, status: "running", at: new Date().toISOString() }]);
    setDraft("");
    assistantChatReply(history, { page: "Client portal" })
      .then(({ reply, sources }) => patch((t) => ({ ...t, status: "done", reply: reply || "I couldn't come up with an answer to that. Try asking another way.", sources })))
      .catch((e) => patch((t) => ({ ...t, status: "error", reply: e instanceof Error ? e.message : String(e) })));
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
  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-[var(--chip-bg)] hover:text-text";
  const needle = q.trim().toLowerCase();
  const listed = chats.filter((c) => !needle || c.title.toLowerCase().includes(needle) || c.turns.some((t) => t.prompt.toLowerCase().includes(needle)));
  const groups = ["Today", "Yesterday", "Last 7 days", "Older"]
    .map((g) => ({ g, items: listed.filter((c) => groupOf(c.updatedAt) === g) }))
    .filter((x) => x.items.length);

  return (
    <>
      {/* A floating button, bottom right, on every page (deck slide 10).
          Portalled so it isn't part of the header it is declared in. */}
      {createPortal(<div className="group fixed bottom-5 right-5 z-[86] flex items-center gap-2 sm:bottom-7 sm:right-7">
        {!open && (
          <span className="pointer-events-none hidden rounded-md bg-text px-2 py-1 text-xs font-semibold text-bg opacity-0 transition-opacity group-hover:opacity-100 sm:block">
            Ask Madeline
          </span>
        )}
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close Madeline" : "Ask Madeline"}
          aria-expanded={open}
          className={cn(
            "h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--c-accent-strong))] text-white shadow-lg shadow-black/20 transition-transform hover:scale-105 sm:h-14 sm:w-14",
            open ? "hidden sm:flex" : "flex",
          )}
        >
          {open ? <X size={24} /> : <Sparkles size={22} />}
        </button>
      </div>, document.body)}

      {open && createPortal(
        <aside
          role="dialog"
          aria-label="Madeline"
          className="fixed inset-0 z-[85] flex flex-col border-border bg-surface shadow-2xl sm:inset-auto sm:bottom-[100px] sm:right-7 sm:h-[min(640px,calc(100vh-120px))] sm:w-[400px] sm:rounded-2xl sm:border"
        >
          {view === "history" ? (
            <>
              <div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
                <button onClick={() => setView("chat")} aria-label="Back to the conversation" className={iconBtn}><ArrowLeft size={17} /></button>
                <p className="flex-1 font-semibold">Chats</p>
                <button onClick={newChat} className="btn-primary h-8 px-3 text-xs"><Plus size={14} /> New chat</button>
                <button onClick={() => setOpen(false)} aria-label="Close Madeline" className={iconBtn}><X size={17} /></button>
              </div>
              <div className="px-3 pt-3">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="input h-9 pl-8 text-sm" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {groups.length === 0 && <p className="px-2 py-8 text-center text-sm text-faint">{chats.length ? "No chats match." : "Your chats will appear here."}</p>}
                {groups.map(({ g, items }) => (
                  <div key={g} className="mb-2">
                    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold text-faint">{g}</p>
                    {items.map((c) => {
                      const last = [...c.turns].reverse().find((t) => t.reply);
                      return (
                        <div key={c.id} className={cn("group relative rounded-lg", c.id === currentId && "bg-[var(--nav-active-bg)]")}>
                          {renaming === c.id ? (
                            <input
                              autoFocus
                              defaultValue={c.title}
                              aria-label="Chat name"
                              className="input m-1 h-8 w-[calc(100%-0.5rem)] text-sm"
                              onBlur={(e) => { renameChat(c.id, e.target.value); setRenaming(null); }}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                            />
                          ) : (
                            <button onClick={() => openChat(c.id)} className="w-full rounded-lg px-2.5 py-2 pr-16 text-left hover:bg-[var(--chip-bg)]">
                              <p className="truncate text-sm font-medium">{c.title}</p>
                              <p className="truncate text-xs text-faint">{last?.reply?.replace(/[#*_`>-]/g, "").slice(0, 80) ?? "…"}</p>
                              <p className="text-[11px] text-faint">{timeOf(c.updatedAt)}</p>
                            </button>
                          )}
                          {renaming !== c.id && (
                            <div className="reveal-on-hover absolute right-1.5 top-1.5 flex">
                              <button onClick={() => setRenaming(c.id)} aria-label={`Rename ${c.title}`} className={iconBtn}><Pencil size={13} /></button>
                              <button onClick={() => deleteChat(c.id)} aria-label={`Delete ${c.title}`} className={cn(iconBtn, "hover:text-red-500")}><Trash2 size={13} /></button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--nav-active-bg)] text-accent"><Sparkles size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{turns.length ? current?.title : "Madeline"}</p>
                  <p className="truncate text-xs text-faint">{turns.length ? `Madeline · ${groupOf(current!.updatedAt)}` : "Your MadeEA assistant"}</p>
                </div>
                <button onClick={() => setView("history")} aria-label="Chat history" title="Chat history" className={iconBtn}><History size={16} /></button>
                <button onClick={newChat} aria-label="New chat" title="New chat" className={iconBtn}><SquarePen size={16} /></button>
                <button onClick={() => setOpen(false)} aria-label="Close Madeline" className={iconBtn}><X size={17} /></button>
              </div>

              <div ref={scroll} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3" aria-live="polite">
                {turns.length === 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="text-lg font-semibold">Hi{first ? ` ${first}` : ""}.</p>
                    <p className="text-[13px] text-muted">
                      {member
                        ? "I can see your own tasks, your hours, the account's meetings and its shared notes. Ask me what's next, or to draft your daily report."
                        : <>I can see your tasks, meetings, hours and the notes you share with your assistant. Ask me where things stand
                          {readOnly ? "." : ", or tell me what you need and I'll turn it into a request."}</>}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {starters.map((s) => (
                        <button key={s} onClick={() => ask(s)} disabled={running}
                          className="rounded-lg border border-border px-3 py-2 text-left text-[13px] font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-40">
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
                className="m-3 mt-0 flex items-end gap-2 rounded-xl border border-border bg-[rgb(var(--c-bg))] py-1.5 pl-3.5 pr-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30"
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white disabled:opacity-40">
                  <ArrowUp size={18} />
                </button>
              </form>
            </>
          )}
        </aside>,
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
      {/* Yours on the right in light orange; Madeline on the left with her sparkle. */}
      <div className="max-w-[88%] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-[var(--nav-active-bg)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[color:var(--nav-active-text)]">
        {turn.prompt}
      </div>
      <div className="flex items-start gap-2 self-start">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--nav-active-bg)] text-accent"><Sparkles size={12} /></span>
      <div className="min-w-0">
      {turn.status === "running" ? (
        <div className="rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3 py-2.5">
          <span className="cc-typing" aria-label="Madeline is thinking"><span /><span /><span /></span>
        </div>
      ) : (
        <div className={cn("rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed", turn.status === "error" && "text-red-500")}>
          {turn.status === "error" ? turn.reply : <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      )}
      {turn.status !== "running" && turn.at && <p className="mt-1 text-[11px] text-faint">{timeOf(turn.at)}</p>}
      </div>
      </div>
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
