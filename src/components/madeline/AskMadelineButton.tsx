import { Sparkles } from "lucide-react";
import { useMadeline } from "@/store/madeline";

/**
 * The one way in. Same button, same place, same panel on every page. It
 * replaces "Ask AI", which opened a different assistant (the Command Center)
 * from the one docked beside it.
 */
export function AskMadelineButton() {
  const open = useMadeline((s) => s.open);
  const toggle = useMadeline((s) => s.toggle);
  return (
    <button
      onClick={toggle}
      className="flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white transition-all hover:brightness-110"
      style={{ boxShadow: "0 4px 14px rgba(253,88,17,0.3)" }}
      aria-label={open ? "Close Madeline" : "Ask Madeline"}
      aria-pressed={open}
      data-tour="madeline"
    >
      <Sparkles size={16} />
      <span className="hidden md:inline">Ask Madeline</span>
    </button>
  );
}
