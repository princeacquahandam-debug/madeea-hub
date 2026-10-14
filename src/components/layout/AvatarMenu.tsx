import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { LogOut, Monitor, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABEL, useMyRole } from "@/data/hooks";
import { useTheme, type ThemeChoice } from "@/store/theme";
import { cn } from "@/lib/utils";

/**
 * The avatar at the far right of the header: profile, settings, theme, help and
 * sign out (12 Oct 2026, UI review deck slide 9).
 *
 * It took over the header's ••• menu. Page help and the tour moved again on
 * 13 Oct 2026, to the Learn button beside it, so they're in plain sight.
 */
export function AvatarMenu() {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const { user, signOut } = useAuth();
  const { data: role } = useMyRole();
  const nav = useNavigate();
  const { choice, setChoice } = useTheme();

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2";
  const themes: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];

  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        aria-label="Your account"
        aria-expanded={open}
        aria-haspopup="menu"
        title={user?.name ?? "Your account"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--nav-active-bg)] text-xs font-bold text-[color:var(--nav-active-text)] transition-shadow hover:ring-2 hover:ring-accent/30"
      >
        {user?.initials || "?"}
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu" style={{ top: pos.top, right: pos.right }} className={`card ${ANCHORED_PANEL_CLASS} !w-64 p-1.5 shadow-xl`}>
          <div className="border-b border-border px-2.5 pb-2.5 pt-1.5">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
            <p className="mt-0.5 text-[11px] text-faint">{ROLE_LABEL[role ?? "ea"] ?? "EA"}</p>
          </div>
          <div className="py-1">
            <button role="menuitem" className={item} onClick={() => { setOpen(false); nav("/settings"); }}>
              <SettingsIcon size={16} className="text-muted" /> Profile & settings
            </button>
          </div>
          <div className="border-t border-border px-2.5 py-2">
            <p className="mb-1.5 text-[11px] font-semibold text-faint">Theme</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-0.5" role="group" aria-label="Theme">
              {themes.map((t) => (
                <button key={t.id} onClick={() => setChoice(t.id)} aria-pressed={choice === t.id}
                  className={cn("flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold transition-colors",
                    choice === t.id ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")}>
                  <t.icon size={13} /> {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-border pt-1">
            <button role="menuitem" className={cn(item, "text-muted")} onClick={() => { setOpen(false); void signOut(); }}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
