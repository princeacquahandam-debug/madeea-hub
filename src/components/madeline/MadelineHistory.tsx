import { useMemo, useState } from "react";
import { ArrowLeft, Check, MessageSquare, Pencil, Search, SquarePen, Trash2, X } from "lucide-react";
import { useMadeline, type MadelineChat } from "@/store/madeline";
import { cn } from "@/lib/utils";

/**
 * Madeline's chat history (12 Oct 2026, UI review deck slide 11). Replaces the
 * conversation inside the same panel; the back arrow returns.
 *
 * Search at the top, "New chat" as the one primary button, chats grouped
 * Today / Yesterday / Last 7 days / Older. Each row: title, a one-line
 * preview, time; the open chat highlighted; rename / delete on hover.
 */
export function MadelineHistory({ onClose }: { onClose: () => void }) {
  const chats = useMadeline((s) => s.chats);
  const currentChatId = useMadeline((s) => s.currentChatId);
  const { openChat, renameChat, deleteChat, clearTurns, setView } = useMadeline.getState();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = chats.filter((c) => !needle || `${c.title} ${preview(c)}`.toLowerCase().includes(needle));
    const today = startOfDay(new Date());
    const out: { label: string; items: MadelineChat[] }[] = [
      { label: "Today", items: [] }, { label: "Yesterday", items: [] }, { label: "Last 7 days", items: [] }, { label: "Older", items: [] },
    ];
    for (const c of list) {
      const days = Math.round((today - startOfDay(new Date(c.updatedAt))) / 86_400_000);
      out[days <= 0 ? 0 : days === 1 ? 1 : days < 7 ? 2 : 3].items.push(c);
    }
    return out.filter((g) => g.items.length);
  }, [chats, q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button onClick={() => setView("chat")} aria-label="Back to the conversation" title="Back"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-[var(--chip-bg)] hover:text-text">
          <ArrowLeft size={17} />
        </button>
        <p className="flex-1 text-sm font-bold">Chats</p>
        <button onClick={clearTurns} className="btn-primary h-8 gap-1.5 px-3 text-xs"><SquarePen size={14} /> New chat</button>
        <button onClick={onClose} aria-label="Close Madeline" title="Close (Esc)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-[var(--chip-bg)] hover:text-text">
          <X size={18} />
        </button>
      </div>
      <label className="relative mt-3 block">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input h-9 pl-8 text-sm" placeholder="Search chats" aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto px-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center text-sm text-faint">
            <MessageSquare size={22} className="mb-2" />
            {chats.length ? `No chats match "${q}".` : "Your conversations with Madeline will appear here."}
          </div>
        ) : groups.map((g) => (
          <div key={g.label} className="mt-2">
            <p className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{g.label}</p>
            {g.items.map((c) => (
              <div key={c.id} className={cn("group relative rounded-lg", c.id === currentChatId ? "bg-[var(--nav-active-bg)]" : "hover:bg-[var(--chip-bg)]")}>
                {editing === c.id ? (
                  <form className="flex items-center gap-1.5 p-2" onSubmit={(e) => { e.preventDefault(); renameChat(c.id, title); setEditing(null); }}>
                    <input autoFocus className="input h-8 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Chat name" maxLength={80}
                      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
                    <button type="submit" aria-label="Save name" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-accent hover:bg-[var(--chip-bg)]"><Check size={16} /></button>
                  </form>
                ) : (
                  <>
                    <button onClick={() => openChat(c.id)} className="block w-full px-2.5 py-2 pr-16 text-left">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-[13px] font-semibold", c.id === currentChatId && "text-[color:var(--nav-active-text)]")}>{c.title}</span>
                        <span className="shrink-0 text-[10.5px] text-faint group-hover:invisible">{when(c.updatedAt)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{preview(c)}</span>
                    </button>
                    <div className="reveal-on-hover absolute right-1.5 top-1.5 flex">
                      <button onClick={() => { setEditing(c.id); setTitle(c.title); }} aria-label={`Rename ${c.title}`} title="Rename"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-text"><Pencil size={13} /></button>
                      <button onClick={() => { if (window.confirm(`Delete "${c.title}"?`)) deleteChat(c.id); }} aria-label={`Delete ${c.title}`} title="Delete"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The last answer's first line, or the last question. */
function preview(c: MadelineChat): string {
  const last = [...c.turns].reverse().find((t) => t.result);
  const r = last?.result as { kind?: string; markdown?: string; text?: string; message?: string } | undefined;
  const text = r?.markdown ?? r?.text ?? r?.message ?? c.turns[c.turns.length - 1]?.prompt ?? "";
  return text.replace(/```[\s\S]*?```/g, "").replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim();
}

/** 11:49 today, "Tue" this week, "Sep 16" older. */
function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
