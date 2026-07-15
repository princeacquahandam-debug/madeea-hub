/**
 * CommandCenter — the centered, glassmorphic modal. Owns keyboard navigation
 * (↑/↓ move, Enter activate/run, Tab completes a suggestion) over a single flat
 * option list derived from the current mode:
 *   - empty query, no history → Suggested + Smart + Recent/Pinned
 *   - typed query            → "Run command" row + instant search results
 * A live conversation transcript sits above the options. All data/logic comes
 * from useCommandCenter; this component is purely presentation + interaction.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Zap, WifiOff, Wand2 } from "lucide-react";
import { useCommandCenter } from "@/hooks/useCommandCenter";
import { parseIntent } from "@/lib/command-center/intentParser";
import { useCommandHistory } from "@/store/commandHistory";
import { ENTITY_META } from "./entityMeta";
import { CommandInput } from "./CommandInput";
import { SuggestionList } from "./SuggestionList";
import { SearchResults } from "./SearchResults";
import { CommandHistory } from "./CommandHistory";
import { ConversationPanel } from "./ConversationPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import type { NavOption } from "./navOption";

function humanize(intent: string): string {
  return intent.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Grouped options for the current mode (keys are mode-dependent, all optional). */
interface Groups {
  run?: NavOption;
  results?: NavOption[];
  suggestions?: NavOption[];
  smart?: NavOption[];
  pinned?: NavOption[];
  recent?: NavOption[];
}

export function CommandCenter() {
  const cc = useCommandCenter();
  const history = useCommandHistory();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState(0);

  const typing = cc.query.trim().length > 0;

  // focus the input whenever the modal opens
  useEffect(() => { if (cc.open) setTimeout(() => inputRef.current?.focus(), 20); }, [cc.open]);
  useEffect(() => { setSel(0); }, [cc.query, cc.open]);

  // Insert a suggestion template into the input (doesn't auto-run) then focus.
  const insert = (prompt: string) => { cc.setQuery(prompt); inputRef.current?.focus(); };

  // ---- build the flat, navigable option list for the current mode ----
  const { groups, flat } = useMemo<{ groups: Groups; flat: NavOption[] }>(() => {
    if (typing) {
      const run: NavOption = {
        id: "run",
        icon: Wand2,
        label: `Run “${cc.query.trim()}”`,
        sub: humanize(parseIntent(cc.query).intent),
        badge: "AI",
        activate: () => cc.submit(),
      };
      const results: NavOption[] = cc.searchResults.map((r) => ({
        id: r.id,
        icon: ENTITY_META[r.type].icon,
        label: r.label,
        sub: r.sub,
        badge: ENTITY_META[r.type].label,
        activate: () => { cc.navigate(r.path); cc.setOpen(false); },
      }));
      return { groups: { run, results }, flat: [run, ...results] };
    }

    const suggestions: NavOption[] = cc.suggestions.map((s) => ({
      id: s.id, icon: s.icon, label: s.label, sub: s.hint,
      activate: () => (s.prompt ? insert(s.prompt) : inputRef.current?.focus()),
    }));
    const smart: NavOption[] = cc.smartSuggestions.map((s) => ({
      id: s.id, icon: s.icon, label: s.label, sub: s.hint,
      activate: () => (s.prompt ? cc.submit(s.prompt) : inputRef.current?.focus()),
    }));
    const pinnedEntries = history.pinned();
    const recentEntries = history.recent(6).filter((e) => !e.pinned);
    const toHist = (e: (typeof recentEntries)[number]): NavOption => ({
      id: e.id, icon: Zap, label: e.prompt, sub: humanize(e.intent),
      pinned: e.pinned, onPin: () => history.togglePin(e.id),
      activate: () => cc.submit(e.prompt),
    });
    const pinned = pinnedEntries.map(toHist);
    const recent = recentEntries.map(toHist);
    return {
      groups: { suggestions, smart, pinned, recent },
      flat: [...suggestions, ...smart, ...pinned, ...recent],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing, cc.query, cc.searchResults, cc.suggestions, cc.smartSuggestions, history.entries]);

  const selectedId = flat[sel]?.id ?? null;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (cc.pendingConfirm) return; // dialog owns the keyboard
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[sel]) flat[sel].activate();
      else if (typing) cc.submit();
    } else if (e.key === "Tab" && !typing && flat[sel]) {
      // Tab-completion: pull the highlighted suggestion into the input.
      const s = [...cc.suggestions, ...cc.smartSuggestions].find((x) => x.id === flat[sel].id);
      if (s?.prompt) { e.preventDefault(); insert(s.prompt); }
    }
  }

  if (!cc.open) return null;

  const showHome = !typing && cc.turns.length === 0;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 pt-[10vh] cc-overlay"
      onClick={() => cc.setOpen(false)}
    >
      <div
        className="cc-glass relative w-full max-w-2xl overflow-hidden rounded-2xl shadow-2xl cc-enter"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="AI Command Center"
      >
        {/* Header / input */}
        <div className="border-b border-border/60">
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="eyebrow flex items-center gap-1.5"><Sparkles size={12} className="text-accent" /> AI Command Center</span>
            {cc.turns.length > 0 && (
              <button className="text-xs text-faint hover:text-zinc-100" onClick={cc.clearConversation}>Clear</button>
            )}
          </div>
          <CommandInput ref={inputRef} value={cc.query} onChange={cc.setQuery} onKeyDown={onKeyDown} running={cc.running} />
        </div>

        {/* Body */}
        <div id="cc-options" role="listbox" aria-label="Commands and results" className="max-h-[64vh] overflow-y-auto p-2">
          {cc.turns.length > 0 && <ConversationPanel turns={cc.turns} onNavigate={(p) => { cc.navigate(p); cc.setOpen(false); }} />}

          {typing ? (
            <>
              <div className="mb-2">
                {/* the always-present "run this as a command" affordance */}
                <SuggestionList
                  title="Command"
                  options={[groups.run!]}
                  selectedId={selectedId}
                  onHover={(id) => setSel(flat.findIndex((f) => f.id === id))}
                />
              </div>
              <SearchResults
                options={groups.results ?? []}
                selectedId={selectedId}
                onHover={(id) => setSel(flat.findIndex((f) => f.id === id))}
                empty={(groups.results ?? []).length === 0}
              />
            </>
          ) : showHome ? (
            <>
              <SuggestionList title="Suggested" options={groups.suggestions ?? []} selectedId={selectedId} onHover={(id) => setSel(flat.findIndex((f) => f.id === id))} />
              <SuggestionList title="Smart" options={groups.smart ?? []} selectedId={selectedId} onHover={(id) => setSel(flat.findIndex((f) => f.id === id))} />
              <CommandHistory title="Pinned" options={groups.pinned ?? []} selectedId={selectedId} onHover={(id) => setSel(flat.findIndex((f) => f.id === id))} />
              <CommandHistory title="Recent Commands" options={groups.recent ?? []} selectedId={selectedId} onHover={(id) => setSel(flat.findIndex((f) => f.id === id))} />
            </>
          ) : (
            <p className="px-3 py-3 text-center text-xs text-faint">Ask a follow-up, or type a new command.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-[11px] text-faint">
          <div className="flex items-center gap-3">
            <span><kbd className="cc-kbd">↑↓</kbd> navigate</span>
            <span><kbd className="cc-kbd">↵</kbd> run</span>
            <span className="hidden sm:inline"><kbd className="cc-kbd">esc</kbd> close</span>
          </div>
          <span className="flex items-center gap-1.5">
            {cc.aiConfigured ? (
              <><Zap size={11} className="text-emerald-400" /> AI connected</>
            ) : (
              <><WifiOff size={11} className="text-amber-400" /> Demo AI</>
            )}
          </span>
        </div>

        {cc.pendingConfirm && (
          <ConfirmDialog label={cc.pendingConfirm.label} onConfirm={cc.pendingConfirm.onConfirm} onCancel={cc.pendingConfirm.onCancel} />
        )}
      </div>
    </div>
  );
}
