import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, RotateCw, Sparkles, X } from "lucide-react";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import { useMadeline } from "@/store/madeline";
import { ago } from "@/lib/quickAi";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * The two ways a ✦ quick action shows its answer (Abder's "AI quick actions and
 * cost" deck, 6 Nov 2026, slide 4). The third, "fill in place", writes into the
 * page's own form with the .ai-filled highlight.
 *
 *   AiCard   summaries, plans and checks: a card at the top of the page;
 *            nothing in your data changes.
 *   AiPanel  batches of changes or drafts: a side panel, a checkbox per item,
 *            nothing changes until Apply / Send / Create.
 *
 * Both follow the deck's eight rules (slide 3): the summary sentence leads,
 * the source line says what was read ("Madeline · Based on your tasks and inbox
 * · just now"), the empty state is one honest line, and "Continue in chat"
 * hands the answer to Madeline. Both close on a click outside (6 Nov call).
 */

interface Common {
  title: string;
  /** "your tasks and inbox", for the source line. */
  source: string;
  at: Date;
  loading?: boolean;
  error?: string | null;
  /** One sentence, counts first. */
  summary?: string;
  /** Shown instead of the body when there is nothing: the action's exact empty line. */
  empty?: string | null;
  onClose: () => void;
  onRefresh?: () => void;
  /** Text handed to Madeline by "Continue in chat". */
  chat?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

function SourceLine({ source, at, loading }: { source: string; at: Date; loading?: boolean }) {
  return (
    <p className="text-xs text-faint">
      Madeline · Based on {source} · {loading ? "working…" : ago(at)}
    </p>
  );
}

function continueInChat(chat: string, onClose: () => void) {
  onClose();
  useMadeline.getState().ask(chat, { send: true });
}

export function AiCard({ title, source, at, loading, error, summary, empty, onClose, onRefresh, chat, children, footer }: Common) {
  const ref = useRef<HTMLElement>(null);
  useOutsideClose(ref, onClose, !loading);
  return (
    <section ref={ref} className="card mb-4 p-4" aria-label={title}>
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--nav-active-bg)] text-accent"><Sparkles size={14} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <SourceLine source={source} at={at} loading={loading} />
        </div>
        {onRefresh && !loading && <button onClick={onRefresh} aria-label="Run again" title="Run again" className="icon-btn text-faint hover:text-text"><RotateCw size={15} /></button>}
        <button onClick={onClose} aria-label="Close" className="icon-btn text-faint hover:text-text"><X size={16} /></button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Madeline is reading…</p>
      ) : error ? (
        <div className="space-y-2 py-1">
          <p className="text-sm text-red-500">{error}</p>
          {onRefresh && <button className="btn-ghost border border-border px-2.5 py-1 text-xs" onClick={onRefresh}>Try again</button>}
        </div>
      ) : (
        <>
          {summary && <p className="mb-2 text-sm font-medium text-text">{summary}</p>}
          {empty ? <p className="text-sm text-muted">{empty}</p> : children}
          {(footer || chat) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {footer}
              {chat && <button onClick={() => continueInChat(chat, onClose)} className="ml-auto text-xs font-semibold text-accent-soft hover:underline">Continue in chat →</button>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function AiPanel({ title, source, at, loading, error, summary, empty, onClose, onRefresh, chat, children, footer }: Common) {
  const ref = useRef<HTMLElement>(null);
  useOutsideClose(ref, onClose, !loading);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <aside
      ref={ref}
      role="dialog"
      aria-label={title}
      className="fixed bottom-0 right-0 top-0 z-[80] flex w-full flex-col border-l border-border bg-surface shadow-2xl sm:w-[460px]"
      style={{ animation: "slideInRight 0.25s cubic-bezier(0.22,1,0.36,1)" }}
    >
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--nav-active-bg)] text-accent"><Sparkles size={15} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <SourceLine source={source} at={at} loading={loading} />
        </div>
        {onRefresh && !loading && <button onClick={onRefresh} aria-label="Run again" title="Run again" className="icon-btn text-faint hover:text-text"><RotateCw size={15} /></button>}
        <button onClick={onClose} aria-label="Close" className="icon-btn text-faint hover:text-text"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Madeline is working…</p>
        ) : error ? (
          <div className="space-y-2 py-1">
            <p className="text-sm text-red-500">{error}</p>
            {onRefresh && <button className="btn-ghost border border-border px-2.5 py-1 text-xs" onClick={onRefresh}>Try again</button>}
          </div>
        ) : (
          <>
            {summary && <p className="mb-3 text-sm text-muted">{summary}</p>}
            {empty ? <p className="text-sm text-muted">{empty}</p> : children}
          </>
        )}
      </div>
      {!loading && !error && (
        <div className="border-t border-border px-4 py-3">
          {empty ? <button className="btn-primary w-full justify-center" onClick={onClose}>Done</button> : footer}
          {chat && (
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-faint">{empty ? "Click outside to close." : "Nothing changes until you confirm."}</span>
              <button onClick={() => continueInChat(chat, onClose)} className="font-semibold text-accent-soft hover:underline">Continue in chat →</button>
            </div>
          )}
        </div>
      )}
    </aside>,
    document.body,
  );
}

/* ── The ✦ buttons beside a page title ── */

export interface AiAction {
  label: string;
  /** Hover text: what it does. */
  help: string;
  run: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Hover text when disabled, e.g. "Disabled when the report is empty". */
  disabledHelp?: string;
}

const TRIED_KEY = "madeea-ai-actions-tried";
const readTried = () => { try { return localStorage.getItem(TRIED_KEY) === "1"; } catch { return true; } };

/** Up to 3 ✦ buttons next to the page title (deck slide 2). */
export function AiActionBar({ actions, page }: { actions: AiAction[]; page: string }) {
  const tried = readTried();
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-tour="ai-actions" aria-label="AI actions" data-keep-open>
      {/* The hover text sits on a wrapper: a disabled button gets no pointer
          events, so its own title would never show the reason it's disabled. */}
      {actions.map((a) => (
        <span key={a.label} title={a.disabled ? a.disabledHelp ?? a.help : a.help} className="inline-flex">
        <button
          type="button"
          disabled={a.disabled || a.busy}
          onClick={() => {
            try { localStorage.setItem(TRIED_KEY, "1"); } catch { /* storage blocked */ }
            track("ai_action_clicked", { action: a.label, page });
            a.run();
          }}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border border-accent/50 bg-[var(--nav-active-bg)] px-3 text-xs font-semibold text-[color:var(--nav-active-text)] transition-colors hover:border-accent hover:bg-accent hover:text-white disabled:pointer-events-none disabled:opacity-40",
            !tried && !a.disabled && "ai-attention",
          )}
        >
          {a.busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {a.label}
        </button>
        </span>
      ))}
    </div>
  );
}
