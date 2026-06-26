import { NavLink } from "react-router-dom";
import { NAV } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const groups = ["Operations", "AI Suite"] as const;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface">
      <div className="px-5 py-5">
        <img src="/logo.png" alt="MadeEA" className="h-7 w-auto" />
        <p className="eyebrow mt-2 text-accent/80">Command Center</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 space-y-6">
        {groups.map((group) => (
          <div key={group} data-tour={group === "Operations" ? "nav" : "ai-suite"}>
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
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent-soft">
            {user?.initials ?? "SM"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user?.name ?? "—"}</p>
            <p className="truncate text-xs text-faint">Elite EA</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
