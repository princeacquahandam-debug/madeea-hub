import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { ClientSwitcher } from "@/components/ClientSwitcher";
import { atLeast, ROLE_LABEL } from "@/data/hooks";
import {
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Sun,
  FolderOpen,
  BookMarked,
  SlidersHorizontal,
  Briefcase,
  Timer,
} from "lucide-react";

const GROUP_ICON: Record<NavGroup, LucideIcon> = {
  Today: Sun,
  Work: Briefcase,
  "Time & Reports": Timer,
  "Clients & Files": FolderOpen,
  "Guides & Training": BookMarked,
  Settings: SlidersHorizontal,
};

/* Every group open on a first visit. When the sidebar was 21 links, only My
   Day started open; the audit found that closed groups hid what was in them
   ("you have to open them and find them"). At 10 to 13 links it fits open. A
   group someone closes stays closed. */
const DEFAULT_OPEN: Record<string, boolean> = {
  Today: true, Work: true, "Time & Reports": true, "Clients & Files": true, "Guides & Training": true, Settings: true,
};
const OPEN_KEY = "madeea-nav-open";

// Slugs the guided tour targets. Kept beside the group list so renaming a group
// cannot silently leave the tour pointing at a selector that stopped rendering,
// which is exactly what happened to the old "ai-suite" step.
const TOUR_ANCHOR: Record<NavGroup, string> = {
  Today: "nav",
  Work: "work",
  "Time & Reports": "time-reports",
  "Clients & Files": "clients-files",
  "Guides & Training": "playbook",
  Settings: "setup",
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
import { NAV, NAV_GROUPS, SIDEBAR_NAV, type NavGroup, type NavItem } from "@/lib/constants";
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
  /* Filtered ONCE, and everything below reads this rather than NAV.
     The sidebar renders its items in three places — the collapsed rail, the
     expanded list, and the active-group lookup. A role filter applied to two
     of them is not a filter: the link simply reappears when somebody collapses
     the sidebar, which is the version of this bug nobody would think to test
     for. */
  const nav = useMemo(
    () => SIDEBAR_NAV.filter((n) => !n.minRole || atLeast(role, n.minRole)),
    [role],
  );
  /* A link is "here" on its own page AND on its tabs: on /routines the Task
     Manager link is the one lit, since that's the page you're in. */
  const isHere = (item: NavItem) => {
    const paths = [item.to, ...NAV.filter((n) => n.parent === item.to).map((n) => n.to)];
    return paths.some((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p)));
  };
  // Intersected with the nav rather than taken from it, so the declared order in
  // NAV_GROUPS decides the sidebar order while an empty group still cannot
  // render. That last part matters: "AI Suite" sat here for weeks after the
  // 09 Aug cut emptied it, as a header you could click to expand onto nothing.
  // It matters again now that a role can empty a group.
  const groups = useMemo(() => {
    const present = new Set(nav.map((n) => n.group));
    return NAV_GROUPS.filter((g) => present.has(g));
  }, [nav]);
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
    [nav, pathname],
  );

  /* A default, never a lock.
     This used to read `openGroups[g] || g === activeGroup`, which forced the
     active group open and made its header unclickable: you were on /time, My
     Day was pinned open, and the toggle did nothing at all. A control that
     looks interactive and is not is worse than no control.

     So an explicit choice always wins. Only when the user has never touched a
     group do we fall back to the default: every group open (DEFAULT_OPEN),
     plus whichever group holds the current page. */
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

  /* ONE hover menu at a time, with ONE timer. Each title used to keep its own,
     so passing over "Time & Reports" on the way down into the open "Work" menu
     left a timer running that nothing cancelled, and the menus swapped under
     the pointer. Now any new intent replaces the pending one. */
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverTo = (g: string | null, delay: number) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHoverGroup(g), delay);
  };
  useEffect(() => { window.clearTimeout(hoverTimer.current); setHoverGroup(null); }, [pathname]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

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

        {/* Collapsing must not hide which client is selected: that is the one
            piece of state that changes what every other screen shows. */}
        <div className="mb-3">
          <ClientSwitcher collapsed />
        </div>

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
                  nav.filter((n) => n.group === group).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      onClick={onNavigate}
                      title={item.label}
                      aria-label={item.label}
                      className={() =>
                        cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text",
                          isHere(item) && "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]",
                        )
                      }
                    >
                      <item.icon size={19} className="shrink-0" />
                    </NavLink>
                  ))}
              </div>
            );
          })}
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

      {/* First thing under the wordmark, as in GHL. "Whose work am I looking
          at" has to be answerable before anything else on the screen is read,
          because a filtered view that looks unfiltered reads as an empty one. */}
      <ClientSwitcher />

      <NavScroller className={cn("px-3 pb-2", forceExpanded ? "space-y-4" : "space-y-1")}>
        {/* Distinct tour anchors per group. Two groups sharing one data-tour value
            would make the guided tour highlight whichever it found first. */}
        {/* DESKTOP: hover menus (9 Oct 2026, the client's request: "when you aim
            your mouse on the title of category it automatically shows its
            menu"). The phone drawer keeps the accordion below, because a
            touch screen has no hover. */}
        {!forceExpanded && groups.map((group) => (
          <HoverGroup
            key={group}
            open={hoverGroup === group}
            /* 120ms to open: brushing past a title on the way into an open
               menu doesn't swap menus, and it still feels immediate. 180ms to
               close, so the pointer can cross the gap into the menu. Inside a
               menu, or clicking a title, is immediate. */
            onEnterTitle={() => hoverTo(group, 120)}
            onEnterMenu={() => hoverTo(group, 0)}
            onLeave={() => hoverTo(null, 180)}
            onToggle={() => { window.clearTimeout(hoverTimer.current); setHoverGroup(hoverGroup === group ? null : group); }}
            onClose={() => { window.clearTimeout(hoverTimer.current); setHoverGroup(null); }}
            group={group}
            icon={GROUP_ICON[group]}
            tour={TOUR_ANCHOR[group]}
            items={nav.filter((n) => n.group === group)}
            isHere={isHere}
            onNavigate={onNavigate}
          />
        ))}
        {forceExpanded && groups.map((group) => {
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
                  {nav.filter((n) => n.group === group).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      onClick={onNavigate}
                      className={() => cn("nav-item", isHere(item) && "active")}
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
            {/* One label source. This tested role === "admin" and said "Elite EA" for
                everything else, so an owner and a manager both read as an EA. */}
            <p className="truncate text-xs text-faint">{ROLE_LABEL[role ?? "employee"] ?? "EA"}</p>
          </div>
          <SettingsIcon size={15} className="text-faint transition-colors group-hover:text-text" />
        </NavLink>
      </div>
    </aside>
  );
}

/* ── A category title that opens its menu on hover ─────────────────────────
   Like a website's top menu, turned on its side: the title stays in the
   sidebar, and its pages open in a small menu beside it.

   PORTALLED. The sidebar has backdrop-filter (which makes it the containing
   block for anything fixed inside it) and a scrolling list that clips, so the
   menu is drawn on <body> and placed from the title's position on screen.

   NOT HOVER-ONLY. Clicking the title opens it too (touch screens, keyboards),
   Escape closes it, and a short delay on close lets the pointer travel from
   the title into the menu without it vanishing. */
function HoverGroup({ group, icon: Icon, tour, items, isHere, onNavigate, open, onEnterTitle, onEnterMenu, onLeave, onToggle, onClose }: {
  group: string;
  icon: LucideIcon;
  tour: string;
  items: NavItem[];
  isHere: (item: NavItem) => boolean;
  onNavigate?: () => void;
  open: boolean;
  onEnterTitle: () => void;
  onEnterMenu: () => void;
  onLeave: () => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = items.find(isHere) ?? null;

  // Placed from the title's position each time it opens.
  useLayoutEffect(() => {
    if (!open) return;
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const side = el.closest("aside")?.getBoundingClientRect();
    // Kept on screen near the bottom edge.
    const estimate = 16 + items.length * 40;
    setPos({ top: Math.max(8, Math.min(r.top - 6, window.innerHeight - estimate - 8)), left: (side?.right ?? r.right) + 6 });
  }, [open, items.length]);

  // Escape closes it; so does resizing, or scrolling the sidebar or the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { onClose(); anchor.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [open, onClose]);

  return (
    <div data-tour={tour} onMouseEnter={onEnterTitle} onMouseLeave={onLeave}>
      <button
        ref={anchor}
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--chip-bg)]",
          open && "bg-[var(--chip-bg)]",
          current && "bg-[var(--nav-active-bg)]",
        )}
      >
        <Icon size={16} className={cn("shrink-0", current ? "text-[color:var(--nav-active-text)]" : "text-accent")} />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[13.5px] font-semibold", current ? "text-[color:var(--nav-active-text)]" : "text-text")}>{group}</span>
          {/* Where you are, since the pages themselves are tucked away. */}
          {current && <span className="block truncate text-[11.5px] text-muted">{current.label}</span>}
        </span>
        <ChevronRight size={14} className={cn("shrink-0 text-faint transition-transform", open && "translate-x-0.5 text-accent")} />
      </button>

      {open && pos && createPortal(
        <div
          role="menu"
          aria-label={group}
          onMouseEnter={onEnterMenu}
          onMouseLeave={onLeave}
          style={{ top: pos.top, left: pos.left }}
          // Solid, not the glass card: page text must not show through the menu.
          className="fixed z-[60] min-w-[220px] rounded-xl border border-border bg-surface p-1.5 shadow-2xl"
        >
          <p className="eyebrow px-2.5 pb-1 pt-1">{group}</p>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              role="menuitem"
              onClick={() => { onClose(); onNavigate?.(); }}
              className={() => cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--chip-bg)]",
                isHere(item) ? "bg-[var(--nav-active-bg)] font-semibold text-[color:var(--nav-active-text)]" : "text-text",
              )}
            >
              <item.icon size={16} className="shrink-0" />
              <span className="flex-1 whitespace-nowrap">{item.label}</span>
              {item.badge && <span className="pill bg-accent/15 text-[10px] text-accent-soft">{item.badge}</span>}
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
