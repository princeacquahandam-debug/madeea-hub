import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Menu, X, Sun, Handshake, MessagesSquare, Settings, Briefcase, ChevronRight, type LucideIcon } from "lucide-react";
import { AmbientBackground } from "@/components/layout/AmbientBackground";
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
  /** Desktop: category titles that open their pages on hover, as the Hub's
      sidebar does (9 Oct 2026). The phone drawer always lists them. */
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
  /* One hover menu at a time, one timer: the same rules as the Hub sidebar. */
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverTo = (g: string | null, delay: number) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHoverGroup(g), delay);
  };
  useEffect(() => { window.clearTimeout(hoverTimer.current); setHoverGroup(null); }, [active]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const groups = [...new Set(nav.map((n) => n.group))];
  const initials = (clientName || "?")
    .split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const rail = (hover: boolean) => (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-border backdrop-blur-lg"
      style={{ background: "var(--sidebar-bg)" }}
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

      <nav className={cn("no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-2", hover ? "space-y-1" : "space-y-5")}>
        {hover && groups.map((group) => (
          <HoverGroup
            key={group}
            group={group}
            icon={GROUP_ICON[group]}
            items={nav.filter((n) => n.group === group)}
            active={active}
            open={hoverGroup === group}
            onEnterTitle={() => hoverTo(group, 120)}
            onEnterMenu={() => hoverTo(group, 0)}
            onLeave={() => hoverTo(null, 180)}
            onToggle={() => { window.clearTimeout(hoverTimer.current); setHoverGroup(hoverGroup === group ? null : group); }}
            onClose={() => { window.clearTimeout(hoverTimer.current); setHoverGroup(null); }}
            onSelect={(id) => { setHoverGroup(null); onSelect(id); }}
          />
        ))}
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
    <div className="relative z-10 flex h-screen overflow-hidden bg-transparent">
      {/* The six drifting blobs the agency shell renders. body paints
          --ambient-base for both, but only AppShell was layering this over it,
          which is the whole of why the two looked like different products even
          after the tokens matched. */}
      <AmbientBackground />
      {/* relative z-[1] on the rail and the content column: the ambient
          layer is position:fixed z-0 in this same stacking context, so it was
          painted OVER every non-positioned element. Cards survived (they make
          their own stacking context); page titles, headings and the whole of
          Activity and Calendar did not, and the portal looked blank. */}
      <div className="relative z-[1] hidden lg:block">{rail(hoverMenus)}</div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 h-full">{rail(false)}</div>
        </div>
      )}

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 lg:px-6">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text lg:hidden"
          >
            <Menu size={18} />
          </button>

          <p className="min-w-0 flex-1 truncate text-sm text-muted">
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
          <div className="mb-7">
            <h1 className="greeting-title">{title}</h1>
            <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

/* ── A category title that opens its pages on hover ────────────────────────
   The portal's copy of the Hub sidebar's HoverGroup (layout/Sidebar.tsx):
   portalled because the rail has backdrop-filter and a clipping scroll area;
   click and Escape work as well as hover; the current page shows under its
   category, since the pages themselves are tucked away. */
function HoverGroup({ group, icon: Icon, items, active, open, onEnterTitle, onEnterMenu, onLeave, onToggle, onClose, onSelect }: {
  group: string;
  icon?: LucideIcon;
  items: ClientNavItem[];
  active: string;
  open: boolean;
  onEnterTitle: () => void;
  onEnterMenu: () => void;
  onLeave: () => void;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = items.find((i) => i.id === active) ?? null;

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const side = el.closest("aside")?.getBoundingClientRect();
    const estimate = 16 + items.length * 40;
    setPos({ top: Math.max(8, Math.min(r.top - 6, window.innerHeight - estimate - 8)), left: (side?.right ?? r.right) + 6 });
  }, [open, items.length]);

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
    <div onMouseEnter={onEnterTitle} onMouseLeave={onLeave}>
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
        {Icon ? <Icon size={16} className={cn("shrink-0", current ? "text-[color:var(--nav-active-text)]" : "text-accent")} /> : null}
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[13.5px] font-semibold", current ? "text-[color:var(--nav-active-text)]" : "text-text")}>{group}</span>
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
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => onSelect(item.id)}
              aria-current={active === item.id ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--chip-bg)]",
                active === item.id ? "bg-[var(--nav-active-bg)] font-semibold text-[color:var(--nav-active-text)]" : "text-text",
              )}
            >
              <item.icon size={16} className="shrink-0" />
              <span className="flex-1 whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
