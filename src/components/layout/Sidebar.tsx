import { NavLink } from "react-router-dom";
import { Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { NAV } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useMyRole } from "@/data/hooks";
import { cn } from "@/lib/utils";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const { data: role } = useMyRole();
  const groups = ["Operations", "AI Suite", "Second Brain"] as const;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface">
      <div className="px-5 py-5">
        <img src="/logo.png" alt="MadeEA" className="h-7 w-auto" />
        <p className="eyebrow mt-2 text-accent/80">Command Center</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 space-y-6">
        {/* Distinct tour anchors per group — two groups sharing one data-tour value
            would make the guided tour highlight whichever it found first. */}
        {groups.map((group) => (
          <div key={group} data-tour={group === "Operations" ? "nav" : group === "AI Suite" ? "ai-suite" : "second-brain"}>
            <p className="eyebrow px-3 mb-2">{group}</p>
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === group).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={onNavigate}
                  className={({ isActive }) => cn("nav-item", isActive && "active")}
                >
                  <item.icon size={17} className="shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span className="pill bg-accent/15 text-accent-soft text-[10px]">{item.badge}</span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}

        {role === "admin" && (
          <div data-tour="admin">
            <p className="eyebrow px-3 mb-2">Administration</p>
            <div className="space-y-0.5">
              <NavLink
                to="/admin"
                onClick={onNavigate}
                className={({ isActive }) => cn("nav-item", isActive && "active")}
              >
                <ShieldCheck size={17} className="shrink-0" />
                <span className="flex-1 truncate">Admin Panel</span>
                <span className="pill bg-accent/15 text-accent-soft text-[10px]">Admin</span>
              </NavLink>
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-border p-3">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) => cn("group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2", isActive && "bg-surface-2")}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent-soft">
            {user?.initials ?? "SM"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name ?? "—"}</p>
            <p className="truncate text-xs text-faint">Elite EA</p>
          </div>
          <SettingsIcon size={15} className="text-faint transition-colors group-hover:text-zinc-100" />
        </NavLink>
      </div>
    </aside>
  );
}
