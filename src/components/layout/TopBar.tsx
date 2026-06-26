import { Menu, HelpCircle } from "lucide-react";
import { todayLabel } from "@/lib/utils";
import { GlobalSearch } from "./GlobalSearch";
import { Notifications } from "./Notifications";
import { useTour } from "@/store/tour";

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const startTour = useTour((s) => s.start);
  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface/60 px-4 lg:px-6 py-3">
      <button className="btn-ghost lg:hidden -ml-2" onClick={onMenu} aria-label="Open menu">
        <Menu size={18} />
      </button>
      <span className="hidden sm:block text-sm text-faint">{todayLabel()}</span>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-2 sm:flex" data-tour="search">
          <GlobalSearch />
          <kbd className="pill hidden bg-surface-2 text-faint lg:inline-flex">⌘K</kbd>
        </div>
        <button className="btn-ghost px-2" onClick={startTour} aria-label="Replay guided tour" title="Replay tour">
          <HelpCircle size={18} />
        </button>
        <Notifications />
      </div>
    </header>
  );
}
