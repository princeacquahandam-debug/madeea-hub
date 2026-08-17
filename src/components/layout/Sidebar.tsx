import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Settings as SettingsIcon,
  ShieldCheck,
  ChevronLeft,
  ChevronDown,
  Sun,
  FolderOpen,
  BookMarked,
  Brain,
  SlidersHorizontal,
} from "lucide-react";

const GROUP_ICON: Record<NavGroup, LucideIcon> = {
  "My Day": Sun,
  "Clients & Files": FolderOpen,
  Playbook: BookMarked,
  Insights: Brain,
  Setup: SlidersHorizontal,
};

// Only My Day is open on a first visit. Everything else starts closed, so the
// sidebar opens as five headings and six links instead of a 21-item wall. The
// group holding the current page is force-opened below regardless.
const DEFAULT_OPEN: Record<string, boolean> = { "My Day": true };
const OPEN_KEY = "madeea-nav-open";

// Slugs the guided tour targets. Kept beside the group list so renaming a group
// cannot silently leave the tour pointing at a selector that stopped rendering,
// which is exactly what happened to the old "ai-suite" step.
const TOUR_ANCHOR: Record<NavGroup, string> = {
  "My Day": "nav",
  "Clients & Files": "clients-files",
  Playbook: "playbook",
  Insights: "insights",
  Setup: "setup",
};

// Scrollable nav with no visible scrollbar; shows an animated down-chevron while
// there is more content below the fold.
function NavScroller({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return (
    <div className="relative min-h-0 flex-1">
      <nav ref={ref} className={cn("no-scrollbar h-full overflow-y-auto", className)}>
        {children}
      </nav>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1.5 pt-7 transition-opacity duration-200",
          more ? "opacity-100" : "opacity-0",
        )}
        style={{ background: "linear-gradient(to top, var(--sidebar-bg), transparent)" }}
        aria-hidden="true"
      >
        <ChevronDown size={18} className="text-accent" style={{ animation: "arrowBounce 1.4s ease-in-out infinite" }} />
      </div>
    </div>
  );
}
import { NAV, NAV_GROUPS, type NavGroup } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useMyRole } from "@/data/hooks";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/utils";

// `forceExpanded` is used by the mobile drawer, which is always full-width.
export function Sidebar({ onNavigate, forceExpanded }: { onNavigate?: () => void; forceExpanded?: boolean }) {
  const { user } = useAuth();
  const { data: role } = useMyRole();
  const { sidebarCollapsed, toggleSidebar } = useUI();
  const { pathname } = useLocation();
  // Intersected with NAV rather than taken from it, so the declared order in
  // NAV_GROUPS decides the sidebar order while an empty group still cannot
  // render. That last part matters: "AI Suite" sat here for weeks after the
  // 09 Aug cut emptied it, as a header you could click to expand onto nothing.
  const groups = useMemo(() => {
    const present = new Set(NAV.map((n) => n.group));
    return NAV_GROUPS.filter((g) => present.has(g));
  }, []);
  const collapsed = sidebarCollapsed && !forceExpanded;

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // Which groups you left open is a preference, and re-collapsing them on
    // every reload made the sidebar feel like it was resetting itself.
    try {
      const saved = localStorage.getItem(OPEN_KEY);
      return saved ? { ...DEFAULT_OPEN, ...JSON.parse(saved) } : { ...DEFAULT_OPEN };
    } catch {
      return { ...DEFAULT_OPEN };
    }
  });
  /* The group holding the current page, so it can open by DEFAULT.
     Without that, visiting /scoreboard with Insights collapsed rendered no link
     to it and no active highlight anywhere, and the sidebar told you nothing
     about where you were. */
  const activeGroup = useMemo(
    () =>
      NAV.filter((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))
        // Longest match wins, so /saved does not lose to /.
        .sort((a, b) => b.to.length - a.to.length)[0]?.group,
    [pathname],
  );

  /* A default, never a lock.
     This used to read `openGroups[g] || g === activeGroup`, which forced the
     active group open and made its header unclickable: you were on /time, My
     Day was pinned open, and the toggle did nothing at all. A control that
     looks interactive and is not is worse than no control.

     So an explicit choice always wins. Only when the user has never touched a
     group do we fall back to the default, which is My Day plus whichever group
     holds the current page. */
  const isOpen = (g: string) =>
    g in openGroups ? openGroups[g] : Boolean(DEFAULT_OPEN[g]) || g === activeGroup;

  /* Toggles from what is on SCREEN, not from what is stored.
     An auto-expanded group has no stored value, so `!openGroups[g]` was
     `!undefined` = true, which "opened" a group that was already open. Second
     way the same click did nothing. */
  const toggleGroup = (g: string) =>
    setOpenGroups((s) => {
      const visible = g in s ? s[g] : Boolean(DEFAULT_OPEN[g]) || g === activeGroup;
      const next = { ...s, [g]: !visible };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });

  // ---------------------------------------------------------------- collapsed
  if (collapsed) {
    return (
      <aside
        className="flex h-full w-20 flex-col items-center border-r border-border py-4 backdrop-blur-lg"
        style={{ background: "var(--sidebar-bg)" }}
      >
        <img src="/icon.png" alt="MadeEA" className="mb-3 h-8 w-8 object-contain" />
        <button
          onClick={toggleSidebar}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
        >
          <ChevronLeft size={18} className="rotate-180" />
        </button>

        <NavScroller className="flex flex-col items-center gap-1">
          {/* Each group is a toggle icon; its item-icons only show while open.
              A rule between groups, because with several open this is otherwise
              twenty identical-sized icons in one column with nothing marking
              where one group ends. The labels are gone here, so the grouping is
              the only structure left and it has to survive collapse. */}
          {groups.map((group, gi) => {
            const open = isOpen(group);
            const GroupIcon = GROUP_ICON[group];
            return (
              <div
                key={group}
                className={cn(
                  "flex w-full shrink-0 flex-col items-center gap-1",
                  gi > 0 && "mt-1 border-t border-border pt-2",
                )}
              >
                <button
                  onClick={() => toggleGroup(group)}
                  title={`${group} (${open ? "hide" : "show"})`}
                  aria-label={`${open ? "Collapse" : "Expand"} ${group}`}
                  aria-expanded={open}
                  className={cn(
                    /* shrink-0 on every row in this column. It is a flex column
                       with overflow-y:auto, and flex children shrink before the
                       scrollbar appears, so with all five groups open (1131px
                       of rows into 855px) the icons would be squeezed shorter
                       instead of scrolling. */
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-[var(--chip-bg)]",
                    open ? "text-accent" : "text-faint",
                  )}
                >
                  <GroupIcon size={18} className="shrink-0" />
                </button>
                {open &&
                  NAV.filter((n) => n.group === group).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      onClick={onNavigate}
                      title={item.label}
                      aria-label={item.label}
                      className={({ isActive }) =>
                        cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text",
                          isActive && "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]",
                        )
                      }
                    >
                      <item.icon size={19} className="shrink-0" />
                    </NavLink>
                  ))}
              </div>
            );
          })}
          {role === "admin" && (
            <NavLink
              to="/admin"
              onClick={onNavigate}
              title="Admin Panel"
              aria-label="Admin Panel"
              className={({ isActive }) =>
                cn(
                  "mt-1 flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text",
                  isActive && "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]",
                )
              }
            >
              <ShieldCheck size={19} className="shrink-0" />
            </NavLink>
          )}
        </NavScroller>

        {/* Avatar + gear, the same pair the expanded sidebar shows. This slot
            used to hold a theme toggle, so collapsing the sidebar silently
            swapped one control for another, the gear you were aiming at became
            a sun. The toggle is not lost: TopBar has had one all along, which is
            also why having a second one here was a duplicate. */}
        <div className="mt-3 flex flex-col items-center gap-3 border-t border-border pt-4">
          <NavLink to="/settings" onClick={onNavigate} title="Open settings">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-sm font-semibold text-accent-soft">
              {user?.initials ?? "SM"}
            </div>
          </NavLink>
          <NavLink
            to="/settings"
            onClick={onNavigate}
            title="Settings"
            aria-label="Settings"
            className={({ isActive }) =>
              cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text",
                isActive && "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]",
              )
            }
          >
            <SettingsIcon size={17} />
          </NavLink>
        </div>
      </aside>
    );
  }

  // ---------------------------------------------------------------- expanded
  return (
    <aside
      className="flex h-full w-64 flex-col border-r border-border backdrop-blur-lg"
      style={{ background: "var(--sidebar-bg)" }}
    >
      <div className="flex items-start justify-between gap-2 px-5 py-5">
        <div className="min-w-0">
          {/* Same wordmark, recoloured per theme: light-ink for dark bg, dark-ink for
              light bg. max-w-none overrides Tailwind's img max-width:100% so the
              wordmark keeps its true aspect ratio in the narrow header row. */}
          <img src="/logo-light.png" alt="MadeEA" className="h-6 w-auto max-w-none [[data-theme=light]_&]:hidden" />
          <img src="/logo-dark.png" alt="MadeEA" className="hidden h-6 w-auto max-w-none [[data-theme=light]_&]:block" />
          <p className="mt-2 text-[10.5px] font-bold uppercase tracking-[0.22em] text-accent">Executive OS</p>
        </div>
        {!forceExpanded && (
          <button
            onClick={toggleSidebar}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text lg:flex"
          >
            <ChevronLeft size={18} />
          </button>
        )}
      </div>

      <NavScroller className="px-3 space-y-5 pb-2">
        {/* Distinct tour anchors per group. Two groups sharing one data-tour value
            would make the guided tour highlight whichever it found first. */}
        {groups.map((group) => {
          const open = isOpen(group);
          const GroupIcon = GROUP_ICON[group];
          return (
            /* The guided tour anchors on these. Two groups sharing one
               data-tour value would make it highlight whichever it found
               first, so each gets its own slug. */
            <div key={group} data-tour={TOUR_ANCHOR[group]}>
              <button
                onClick={() => toggleGroup(group)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors hover:text-text"
              >
                <GroupIcon size={14} className="shrink-0 text-accent" />
                <span className="eyebrow flex-1">{group}</span>
                <ChevronDown size={14} className={cn("text-faint transition-transform", !open && "-rotate-90")} />
              </button>
              {open && (
                <div className="mt-1 space-y-0.5">
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
              )}
            </div>
          );
        })}

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
      </NavScroller>

      {/* The Academy promo card used to sit here: a 150px orange block pinned
          above the footer, advertising a page that had no nav entry.

          It has now lost its job twice over. The Training Center is a permanent
          item under Playbook, so the card is no longer the only way in, and it
          was occupying the bottom of a nav that just gained four group headers.
          On a laptop it was covering the Insights and Setup rows outright, so
          an ad for one page was hiding two others.

          useUI still carries academyPromoDismissed and dismissAcademyPromo, and
          Settings still exposes the reset, so restoring the card is this block
          coming back. Nothing was removed from the store. */}

      <div className="border-t border-border p-3">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) => cn("group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--chip-bg)]", isActive && "bg-[var(--chip-bg)]")}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-sm font-semibold text-accent-soft">
            {user?.initials ?? "SM"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name ?? "-"}</p>
            {/* Was hardcoded "Elite EA", which is wrong for an admin and wrong
                for anybody whose title is not that. Read the real role. */}
            <p className="truncate text-xs capitalize text-faint">{role === "admin" ? "Admin" : "Elite EA"}</p>
          </div>
          <SettingsIcon size={15} className="text-faint transition-colors group-hover:text-text" />
        </NavLink>
      </div>
    </aside>
  );
}
