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
      className="flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white transition-all hover:brightness-110"
      style={{ boxShadow: "0 4px 14px rgba(253,88,17,0.3)" }}
      aria-label="Open AI Command Center"
      data-tour="command-center"
    >
      <Sparkles size={16} />
      <span className="hidden md:inline">Ask AI</span>
      <kbd className="hidden rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold text-white lg:inline">⌘K</kbd>
    </button>
  );
}
