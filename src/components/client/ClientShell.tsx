import { useState, type ReactNode } from "react";
import { Menu, X, Sun, Handshake, MessagesSquare, Settings, Briefcase, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The client portal, wearing the same clothes as the rest of the product.
 *
 * WHY THIS EXISTS. The portal shipped as a bare page: a text header, a row of
 * buttons, and sections on the raw background. It worked, and it looked like a
 * different piece of software from the one the agency uses. For a product whose
 * pitch is that the client can see their assistant working, the portal is the
 * only screen most clients will ever see -- it is the product, as far as they
 * are concerned, and it was the one screen with no design on it.
 *
 * SAME PARTS, NOT A LOOKALIKE. The wordmark, `nav-item`, `card`, `pill`,
 * `sidebar-bg` and the accent tokens are the agency shell's own, imported
 * rather than reproduced. A copy drifts the first time somebody changes a
 * token; this moves with it.
 *
 * WHAT IS DELIBERATELY NOT COPIED ACROSS. The client switcher (they are the
 * only account), the search, the clock, Capture, Ask AI, and the notification
 * bell. Every one of those is an agency tool, and a portal that displays a
 * clock-in button the client cannot use is worse than one without it.
 *
 * NAV, NOT TABS. Eight tabs in a row wrapped at laptop width and gave every
 * destination equal weight. In a rail they group: where the account stands,
 * how you work together, and the two ways to reach a person. Below lg there is
 * no room for a rail, so it becomes a drawer -- the same trade the agency shell
 * makes at the same breakpoint.
 */

/* The staff sidebar puts an icon beside every group heading. Matching it is not
   decoration: the icon is what makes a heading read as a section rather than as
   a dimmed nav row that will not click. */
const GROUP_ICON: Record<string, LucideIcon> = {
  "Your account": Sun,
  "Working together": Handshake,
  "Messages": MessagesSquare,
  // The staff account's groups (9 Oct 2026), named like the Hub's.
  "Today": Sun,
  "Work": Briefcase,
  "Notes & messages": MessagesSquare,
};

export interface ClientNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

export function ClientShell({
  nav,
  active,
  onSelect,
  clientName,
  company,
  email,
  isViewer,
  isMember = false,
  hoverMenus = false,
  headerTools,
  title,
  subtitle,
  onOpenSettings,
  settingsActive,
  children,
}: {
  nav: ClientNavItem[];
  active: string;
  onSelect: (id: string) => void;
  clientName: string;
  company: string | null;
  email?: string;
  isViewer: boolean;
  isMember?: boolean;
  /** Category titles that open and close their pages in place, as the Hub's
      sidebar does (12 Oct 2026, UI review deck slide 1; this replaced the
      9 Oct hover menus). Desktop and the phone drawer alike. */
  hoverMenus?: boolean;
  /** Right side of the header: search, guide, theme, notifications, Madeline. */
  headerTools?: React.ReactNode;
  title: string;
  subtitle: string;
  onOpenSettings: () => void;
  settingsActive: boolean;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  /* Which sections are open. A section with no stored choice is open only when
     it holds the current page, the Hub sidebar's rule. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const groups = [...new Set(nav.map((n) => n.group))];
  const activeGroup = nav.find((n) => n.id === active)?.group;
  const isOpen = (g: string) => (g in openGroups ? openGroups[g] : g === activeGroup);
  const toggleGroup = (g: string) => setOpenGroups((o) => ({ ...o, [g]: !isOpen(g) }));
  const initials = (clientName || "?")
    .split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const rail = (hover: boolean) => (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex items-start justify-between gap-2 px-5 py-5">
        <div className="min-w-0">
          {/* The agency wordmark, both themes, exactly as the staff sidebar
              loads it. max-w-none keeps its aspect ratio in a narrow row. */}
          <img src="/logo-light.png" alt="MadeEA" className="h-6 w-auto max-w-none [[data-theme=light]_&]:hidden" />
          <img src="/logo-dark.png" alt="MadeEA" className="hidden h-6 w-auto max-w-none [[data-theme=light]_&]:block" />
          <p className="mt-2 text-[10.5px] font-bold uppercase tracking-[0.22em] text-accent">
            Client Portal
          </p>
        </div>
        <button
          onClick={() => setDrawer(false)}
          aria-label="Close menu"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      {/* Where the staff sidebar puts the client switcher. Same position, same
          question answered: whose account am I looking at. */}
      <div className="mx-3 mb-4 rounded-xl border border-border px-3 py-2.5" style={{ background: "var(--chip-bg)" }}>
        <p className="truncate text-sm font-medium" title={clientName}>{clientName}</p>
        <p className="truncate text-xs text-faint">{company || "Your account"}</p>
      </div>

      <nav className={cn("no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-2", hover ? "space-y-0.5" : "space-y-5")}>
        {/* Inline collapse / expand (deck slide 1): click a section to show its
            pages indented beneath it; the chevron turns when it is open. */}
        {hover && groups.map((group) => {
          const open = isOpen(group);
          const GroupIcon = GROUP_ICON[group];
          const items = nav.filter((n) => n.group === group);
          const here = items.some((i) => i.id === active);
          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--chip-bg)]",
                  here && open ? "bg-[var(--chip-bg)] font-semibold text-[color:var(--nav-active-text)]" : here ? "font-semibold text-text" : "font-medium text-text",
                )}
              >
                {GroupIcon ? <GroupIcon size={16} className={cn("shrink-0", here ? "text-accent" : "text-muted")} /> : null}
                <span className="flex-1 truncate">{group}</span>
                <ChevronRight size={15} className={cn("shrink-0 text-faint transition-transform duration-150", open && "rotate-90")} />
              </button>
              {open && (
                <div className="mb-1 mt-0.5 space-y-0.5">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { onSelect(item.id); setDrawer(false); }}
                      className={cn("nav-item py-1.5 pl-[2.375rem]", active === item.id && "active")}
                      aria-current={active === item.id ? "page" : undefined}
                    >
                      <span className="flex-1 truncate text-left">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!hover && groups.map((group) => {
          const GroupIcon = GROUP_ICON[group];
          return (
          <div key={group}>
            <p className="mb-1.5 flex items-center gap-2 px-3 text-[10.5px] font-bold uppercase tracking-[0.16em] text-faint">
              {GroupIcon ? <GroupIcon size={13} className="shrink-0" /> : null}
              {group}
            </p>
            <div className="space-y-0.5">
              {nav.filter((n) => n.group === group).map((item) => (
                <button
                  key={item.id}
                  onClick={() => { onSelect(item.id); setDrawer(false); }}
                  className={cn("nav-item", active === item.id && "active")}
                  aria-current={active === item.id ? "page" : undefined}
                >
                  <item.icon size={17} className="shrink-0" />
                  <span className="flex-1 truncate text-left">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
          );
        })}
      </nav>

      {/* The staff sidebar's footer is a link to Settings. Same here, so the
          account controls live where a person already looks for them -- and so
          Sign out stops occupying the most prominent spot on the screen for the
          action taken least often. */}
      <div className="border-t border-border p-3">
        <button
          onClick={() => { onOpenSettings(); setDrawer(false); }}
          className={cn(
            "group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--chip-bg)]",
            settingsActive && "bg-[var(--chip-bg)]",
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-sm font-semibold text-accent-soft">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={email}>{email ?? clientName}</p>
            <p className="truncate text-xs text-faint">
              {isViewer ? "View only" : isMember ? "Staff member" : "Primary contact"}
            </p>
          </div>
          <Settings size={15} className="shrink-0 text-faint transition-colors group-hover:text-text" />
        </button>
      </div>
    </aside>
  );

  return (
    <div className="relative z-10 flex h-screen overflow-hidden bg-[rgb(var(--c-bg))]">
      {/* Flat page, no ambient layer (12 Oct 2026, UI review deck slide 2). */}
      <div className="relative z-[1] hidden lg:block">{rail(hoverMenus)}</div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 h-full">{rail(hoverMenus)}</div>
        </div>
      )}

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Flat bar with a 1px bottom border (deck slide 9): date, search in
            the middle, then notifications and the avatar menu. */}
        <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text lg:hidden"
          >
            <Menu size={18} />
          </button>

          <p className="hidden shrink-0 truncate text-sm text-muted md:block">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>

          {isViewer && (
            <span className="pill bg-accent/15 text-accent-soft whitespace-nowrap text-[10px]">View only</span>
          )}
          {headerTools}
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-6">
          {/* greeting-title, the same class the agency dashboard uses for
              "Good afternoon, ...". Solid accent, 40px, 800 weight. The portal
              heading was plain white, which is most of why it read as a
              different product. */}
          <div className="mb-6">
            <h1 className="greeting-title">{title}</h1>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
