/**
 * CommandCenterButton — the TopBar launcher. Opens the Command Center (same as
 * ⌘/Ctrl-K) and advertises the shortcut. Kept tiny so it can drop into any
 * toolbar.
 */
import { Sparkles } from "lucide-react";
import { useCommandCenter } from "@/hooks/useCommandCenter";

export function CommandCenterButton() {
  const { setOpen } = useCommandCenter();
  return (
    <button
      onClick={() => setOpen(true)}
      className="group flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-sm text-accent-soft transition-colors hover:bg-accent/20"
      aria-label="Open AI Command Center"
      data-tour="command-center"
    >
      <Sparkles size={15} />
      <span className="hidden font-medium md:inline">Ask AI</span>
      <kbd className="cc-kbd hidden lg:inline">⌘K</kbd>
    </button>
  );
}
