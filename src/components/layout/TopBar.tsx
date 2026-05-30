import { Bell, Menu, Search } from "lucide-react";
import { todayLabel } from "@/lib/utils";

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface/60 px-4 lg:px-6 py-3">
      <button className="btn-ghost lg:hidden -ml-2" onClick={onMenu} aria-label="Open menu">
        <Menu size={18} />
      </button>
      <span className="hidden sm:block text-sm text-faint">{todayLabel()}</span>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="input w-56 lg:w-72 pl-9"
            placeholder="Search clients, tasks, emails..."
          />
        </div>
        <button className="btn-ghost px-2" aria-label="Notifications">
          <Bell size={18} />
        </button>
      </div>
    </header>
  );
}
