import { NavLink, useLocation } from "react-router-dom";
import { Lock } from "lucide-react";
import { NAV, tabsFor } from "@/lib/constants";
import { atLeast, useMyRole } from "@/data/hooks";
import { cn } from "@/lib/utils";

/**
 * Tabs across the top of a page that has sister pages.
 *
 * The 28 Sep audit grouped pages that are two halves of one job (Calendar and
 * Meeting Intelligence, Task Manager and Routines, Time Tracker and
 * Screenshots, Notes, Uploads and Saved) so the sidebar holds one link per
 * job. Each page keeps its own route, so links into it still work; this strip
 * is how you move between them. Rendered by AppShell, so no page had to change.
 */
export function SectionTabs() {
  const { pathname } = useLocation();
  const { data: role } = useMyRole();
  const found = tabsFor(pathname);
  if (!found) return null;
  const tabs = found.tabs.filter((t) => !t.minRole || atLeast(role, t.minRole));
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label={`${found.parent.label} sections`}
      className="no-scrollbar relative z-[1] mb-4 flex gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
              isActive ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
            )
          }
        >
          <t.icon size={15} className="shrink-0" />
          {t.tab ?? t.label}
          {t.badge && <span className="pill bg-accent/15 text-[10px] text-accent-soft">{t.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The page at this address is above the viewer's role.
 *
 * The sidebar hides those links, but hiding a link doesn't unbookmark it. This
 * says so plainly instead of showing a page whose saves would fail. The real
 * boundary is in Postgres; this is the courtesy in front of it.
 */
export function useRoleBlocked(): string | null {
  const { pathname } = useLocation();
  const { data: role, isLoading } = useMyRole();
  if (isLoading) return null;
  const item = NAV.filter((n) => n.to !== "/" && pathname.startsWith(n.to))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (!item?.minRole || atLeast(role, item.minRole)) return null;
  return item.label;
}

export function RoleBlocked({ label }: { label: string }) {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Lock size={20} />
      </div>
      <h1 className="mt-4 text-lg font-extrabold">{label} isn't part of your access</h1>
      <p className="mt-1.5 text-sm text-muted">Ask an admin if you need it.</p>
    </div>
  );
}
