import { useState } from "react";
import { Menu, Plus } from "lucide-react";
import { todayLabel } from "@/lib/utils";
import { GlobalSearch } from "./GlobalSearch";
import { Notifications } from "./Notifications";
import { VoiceCapture } from "@/components/VoiceCapture";
import { ClockControl } from "@/components/ClockControl";
import { AvatarMenu } from "./AvatarMenu";

/**
 * The header, the same on every page (12 Oct 2026, UI review deck slide 9):
 * date · a visible search field, centred · Clock in (a live timer once
 * clocked in) · Quick note · notifications · avatar.
 *
 * Gone from here: the ⓘ beside the date and the ••• menu (both now in the
 * avatar menu), and Ask Madeline, which is the floating button bottom-right.
 * Flat white bar with a 1px bottom border.
 */
export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const [capturing, setCapturing] = useState(false);
  return (
    <>
    <header className="relative z-40 flex h-[60px] items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
      {/* Menu + logo grouped tightly on mobile (the sidebar, which normally
          carries the logo, is hidden below lg). */}
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
      <span className="hidden shrink-0 text-sm text-muted md:block md:w-44">{todayLabel()}</span>

      {/* Search: a field you can see, centred, with its shortcut. */}
      <div className="hidden min-w-0 flex-1 justify-center sm:flex" data-tour="search">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0 sm:gap-2">
        {/* Clock in / out, deliberately on every page. See ClockControl. */}
        <ClockControl />
        <button
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-text transition-colors hover:bg-[var(--chip-bg)]"
          onClick={() => setCapturing(true)}
          aria-label="Quick note"
          title="Quick note"
        >
          <Plus size={15} />
          <span className="hidden md:inline">Quick note</span>
        </button>
        <Notifications />
        <AvatarMenu />
      </div>
    </header>

    {/* Rendered OUTSIDE the header so its position: fixed centres over the
        whole viewport rather than the 60px bar. */}
    <VoiceCapture open={capturing} onClose={() => setCapturing(false)} />
    </>
  );
}
