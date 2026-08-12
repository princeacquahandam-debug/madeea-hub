import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Settings as SettingsIcon,
  ShieldCheck,
  GraduationCap,
  X,
  ChevronLeft,
  ChevronDown,
  Briefcase,
  Bot,
  Brain,
} from "lucide-react";

const GROUP_ICON = {
  Operations: Briefcase,
  "AI Suite": Bot,
  "Second Brain": Brain,
} as const;

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
import { NAV } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useMyRole } from "@/data/hooks";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/utils";

// `forceExpanded` is used by the mobile drawer, which is always full-width.
export function Sidebar({ onNavigate, forceExpanded }: { onNavigate?: () => void; forceExpanded?: boolean }) {
  const { user } = useAuth();
  const { data: role } = useMyRole();
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar, academyPromoDismissed, dismissAcademyPromo } = useUI();
  const groups = ["Operations", "AI Suite", "Second Brain"] as const;
  const collapsed = sidebarCollapsed && !forceExpanded;
  // Operations is the only group open by default on first load; the rest start collapsed.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Operations: true,
    "AI Suite": false,
    "Second Brain": false,
  });
  const toggleGroup = (g: string) => setOpenGroups((s) => ({ ...s, [g]: !s[g] }));

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
          {/* Each group is a toggle icon; its item-icons only show while open. */}
          {groups.map((group) => {
            const open = openGroups[group];
            const GroupIcon = GROUP_ICON[group];
            return (
              <div key={group} className="flex w-full flex-col items-center gap-1">
                <button
                  onClick={() => toggleGroup(group)}
                  title={`${group} (${open ? "hide" : "show"})`}
                  aria-label={`${open ? "Collapse" : "Expand"} ${group}`}
                  aria-expanded={open}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-[var(--chip-bg)]",
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
                          "flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text",
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
          const open = openGroups[group];
          const GroupIcon = GROUP_ICON[group];
          return (
            <div key={group} data-tour={group === "Operations" ? "nav" : group === "AI Suite" ? "ai-suite" : "second-brain"}>
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

      {/* Academy promo. Opens the MadeEA Academy (walkthrough + playbooks).
          Dismissible: the card is a wrapper rather than one big button, because a
          <button> cannot legally contain the dismiss <button>. Nesting them makes
          the inner click ambiguous and breaks keyboard navigation. */}
      {!academyPromoDismissed && (
        <div
          className="group relative mx-3 mb-3 rounded-2xl shadow-lg transition-transform hover:-translate-y-0.5"
          style={{
            background: "linear-gradient(150deg,#fd5811 0%,#ff8a3d 55%,#f5b544 100%)",
            boxShadow: "0 8px 22px rgba(253,88,17,0.3)",
          }}
        >
          <button
            type="button"
            onClick={dismissAcademyPromo}
            aria-label="Hide the Academy tip"
            title="Hide this. You can bring it back in Settings"
            className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-lg text-white/70 transition-colors hover:bg-black/15 hover:text-white"
          >
            <X size={14} />
          </button>

          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              navigate("/academy");
            }}
            className="w-full rounded-2xl p-4 pr-9 text-left"
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-extrabold text-white">
              <GraduationCap size={15} />
              Become a MadeEA Expert
            </div>
            <p className="mb-3 text-[12px] leading-snug text-white/90">
              Learn to navigate the Command Center end to end and go from new user to power-user Pro.
            </p>
            <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[13px] font-bold text-[#152e47] transition-transform group-hover:scale-[1.02]">
              <GraduationCap size={14} />
              Learn More
            </span>
          </button>
        </div>
      )}

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
            <p className="truncate text-xs text-faint">Elite EA</p>
          </div>
          <SettingsIcon size={15} className="text-faint transition-colors group-hover:text-text" />
        </NavLink>
      </div>
    </aside>
  );
}
