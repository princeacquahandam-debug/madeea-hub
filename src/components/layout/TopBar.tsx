import { useState } from "react";
import { Menu, HelpCircle, Mic, Sun, Moon } from "lucide-react";
import { todayLabel } from "@/lib/utils";
import { GlobalSearch } from "./GlobalSearch";
import { Notifications } from "./Notifications";
import { CommandCenterButton } from "@/components/command-center";
import { VoiceCapture } from "@/components/VoiceCapture";
import { ClockControl } from "@/components/ClockControl";
import { useTour } from "@/store/tour";
import { useTheme } from "@/store/theme";

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const startTour = useTour((s) => s.start);
  const { theme, toggle } = useTheme();
  const [capturing, setCapturing] = useState(false);
  return (
    <>
    <header className="glass relative z-40 flex h-[66px] items-center gap-4 border-b border-border px-4 lg:px-6">
      {/* Menu + logo grouped tightly on mobile (the sidebar, which normally
          carries the logo, is hidden below lg). Compact square icon so it never
          gets squeezed by the flex row. */}
      <div className="-ml-1 flex items-center gap-1.5 lg:hidden">
        <button
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          onClick={onMenu}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <img src="/icon.png" alt="MadeEA" className="h-7 w-7 shrink-0 object-contain" />
      </div>
      <span className="hidden sm:block text-sm font-medium text-muted">{todayLabel()}</span>
      {/* min-w-0 + shrink lets this row give ground instead of overflowing.
          It was `ml-auto flex` with no wrap and no scroll inside an
          `overflow-hidden` ancestor, so at 1024px it ran 101px past the edge
          and at 375px 62px past, with no scrollbar to reach it. Notifications
          was entirely off-screen at both, which is the one control you cannot
          afford to lose: it is how the app tells you something needs you. */}
      <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]{display:none}">
        {/* Global search appears only when there is room for it.
            At 1024px it pushed the action row 123px past its own edge, so
            Notifications scrolled out of sight: a badge you cannot see is not a
            notification. It is also half of the "two search bars" problem, since
            the inbox has its own scoped field. Below xl it collapses into the
            command palette, which is the same search with a keyboard door. */}
        <div className="hidden items-center gap-2 xl:flex" data-tour="search">
          <GlobalSearch />
        </div>
        {/* Clock in / out, deliberately on every page. See ClockControl. */}
        <ClockControl />
        {/* Quick capture, the bottom corners are already taken by the Assistant
            and SOP widgets, so this lives in the header where it's reachable from
            every page on both desktop and mobile. */}
        <button
          className="flex h-10 items-center gap-1.5 rounded-xl border border-accent/70 px-3 text-sm font-bold text-accent transition-colors hover:bg-accent/10"
          onClick={() => setCapturing(true)}
          aria-label="Capture a task by voice"
          title="Quick capture (voice)"
        >
          <Mic size={16} />
          <span className="hidden md:inline">Capture</span>
        </button>
        <CommandCenterButton />
        <button
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          onClick={toggle}
          aria-label="Toggle light / dark theme"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          onClick={startTour}
          aria-label="Replay guided tour"
          title="Replay tour"
        >
          <HelpCircle size={18} />
        </button>
        <Notifications />
      </div>
    </header>

    {/* Rendered OUTSIDE the header: the header's backdrop-filter would otherwise
        become the containing block for this modal's `position: fixed`, trapping
        it inside the 66px bar. Out here it centers over the whole viewport. */}
    <VoiceCapture open={capturing} onClose={() => setCapturing(false)} />
    </>
  );
}
