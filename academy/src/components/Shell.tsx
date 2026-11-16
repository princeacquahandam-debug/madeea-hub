import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import {
  ArrowLeft, Award, BarChart3, BookOpen, GraduationCap, LayoutDashboard, LogOut, MessageSquare, Moon,
  Route as RouteIcon, Settings as SettingsIcon, Sun, Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { HUB_URL } from "@/lib/supabase";

function ThemeToggle() {
  const [t, setT] = useState(() => document.documentElement.getAttribute("data-theme") ?? "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("madeea-academy-theme", t); } catch { /* private mode */ }
  }, [t]);
  return (
    <button className="btn-ghost" onClick={() => setT(t === "dark" ? "light" : "dark")} aria-label="Switch light or dark" title="Light or dark">
      {t === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

const learnerNav = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/certificates", label: "Certificates", icon: Award },
];

const studioNav = [
  { to: "/studio", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/studio/courses", label: "Courses", icon: BookOpen },
  { to: "/studio/paths", label: "Learning paths", icon: RouteIcon },
  { to: "/studio/learners", label: "Learners", icon: Users },
  { to: "/studio/reports", label: "Reports", icon: BarChart3 },
  { to: "/studio/reviews", label: "Reviews", icon: MessageSquare },
  { to: "/studio/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
];

export function Shell({ children }: { children: ReactNode }) {
  const { me, isStaff, isAdmin, signOut } = useAuth();
  const { pathname } = useLocation();
  const inStudio = pathname.startsWith("/studio");
  const nav = (inStudio ? studioNav : learnerNav).filter((n) => !("adminOnly" in n && n.adminOnly) || isAdmin);

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to={inStudio ? "/studio" : "/"} className="flex items-center gap-2 font-extrabold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-strong text-white"><GraduationCap size={17} /></span>
            <span className="hidden sm:inline">MadeEA Academy</span>
          </Link>
          {isStaff && (
            <div className="ml-2 flex rounded-lg border border-border p-0.5 text-sm">
              <Link to="/" className={`rounded-md px-2.5 py-1 ${!inStudio ? "bg-surface-2 font-semibold" : "text-muted"}`}>Learn</Link>
              <Link to="/studio" className={`rounded-md px-2.5 py-1 ${inStudio ? "bg-surface-2 font-semibold" : "text-muted"}`}>Studio</Link>
            </div>
          )}
          <div className="flex-1" />
          <a href={HUB_URL} className="btn-ghost" title="Back to MadeEA Hub">
            <ArrowLeft size={15} /><span className="hidden md:inline">MadeEA Hub</span>
          </a>
          <ThemeToggle />
          <span className="hidden max-w-[10rem] truncate text-sm text-muted lg:inline">{me?.name ?? me?.email}</span>
          <button className="btn-ghost" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={"end" in n ? n.end : false}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${isActive ? "bg-accent/15 font-semibold text-accent-soft" : "text-muted hover:bg-surface-2 hover:text-text"}`
              }
            >
              <n.icon size={15} />{n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: typeof BookOpen; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <Icon size={28} className="mb-3 text-faint" />
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="py-16 text-center text-sm text-faint">Loading…</div>;
}
