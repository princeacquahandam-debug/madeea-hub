import { useState } from "react";
import { Menu, HelpCircle, Mic } from "lucide-react";
import { todayLabel } from "@/lib/utils";
import { GlobalSearch } from "./GlobalSearch";
import { Notifications } from "./Notifications";
import { CommandCenterButton } from "@/components/command-center";
import { VoiceCapture } from "@/components/VoiceCapture";
import { useTour } from "@/store/tour";

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const startTour = useTour((s) => s.start);
  const [capturing, setCapturing] = useState(false);
  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface/60 px-4 lg:px-6 py-3">
      <button className="btn-ghost lg:hidden -ml-2" onClick={onMenu} aria-label="Open menu">
        <Menu size={18} />
      </button>
      <span className="hidden sm:block text-sm text-faint">{todayLabel()}</span>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-2 sm:flex" data-tour="search">
          <GlobalSearch />
        </div>
        {/* Quick capture — the bottom corners are already taken by the Assistant
            and SOP widgets, so this lives in the header where it's reachable from
            every page on both desktop and mobile. */}
        <button
          className="flex h-9 items-center gap-1.5 rounded-lg border border-accent/60 bg-accent/10 px-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
          onClick={() => setCapturing(true)}
          aria-label="Capture a task by voice"
          title="Quick capture (voice)"
        >
          <Mic size={16} />
          <span className="hidden md:inline">Capture</span>
        </button>
        <CommandCenterButton />
        <button className="btn-ghost px-2" onClick={startTour} aria-label="Replay guided tour" title="Replay tour">
          <HelpCircle size={18} />
        </button>
        <Notifications />
      </div>

      <VoiceCapture open={capturing} onClose={() => setCapturing(false)} />
    </header>
  );
}
