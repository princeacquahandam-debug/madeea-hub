import { Suspense, useEffect } from "react";
import { WorkspaceGate } from "@/components/WorkspaceGate";
import { Outlet, useLocation } from "react-router-dom";
import { PageSkeleton } from "@/components/Skeleton";
import { AmbientBackground } from "./AmbientBackground";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MadelineRail } from "./MadelineRail";
import { AssistantWidget } from "@/components/AssistantWidget";
import { FloatingSop } from "@/components/FloatingSop";
import { GuideCard } from "@/components/GuideCard";
import { MonitoringProvider } from "@/store/monitoringContext";
import { CommandCenter } from "@/components/command-center";
import { GuidedTour } from "@/components/GuidedTour";
import { useUI } from "@/store/ui";
import { useSlaSettings } from "@/store/slaSettings";
import { useRoutineRunner } from "@/hooks/useRoutineRunner";

export function AppShell() {
  const { navOpen, setNavOpen } = useUI();
  const location = useLocation();
  /* SLA thresholds moved from localStorage to the sla_settings table (0036).
     Pulled once here, at the first screen behind the login gate, rather than in
     each of the nine pages that read them. */
  const hydrateSla = useSlaSettings((s) => s.hydrate);
  useEffect(() => { void hydrateSla(); }, [hydrateSla]);
  /* Routines create their tasks here, not on the Routines page. You set a
     routine up once and never go back, so anchoring it to that page meant
     Monday's task might never be created. */
  useRoutineRunner();

  return (
    <MonitoringProvider>
    <div className="relative z-10 flex h-screen overflow-hidden bg-transparent">
      <AmbientBackground />
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setNavOpen(false)} forceExpanded />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onMenu={() => setNavOpen(true)} />
        <div className="flex flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-6">
          {/* Above every page: an account with no seat sees zeros everywhere,
              which is indistinguishable from an empty database until something
              says otherwise. */}
          <WorkspaceGate />
            <GuideCard />
            {/* Keyed by path so page content fades up on every route change.
                Suspense shows the shimmer skeleton while a lazy page chunk loads. */}
            <div key={location.pathname} className="page-enter">
              <Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
          <MadelineRail />
        </div>
      </div>

      {/* The Madeline rail is the docked assistant on xl+, so the floating
          launcher only needs to appear on narrower screens. */}
      <div className="xl:hidden">
        <AssistantWidget />
      </div>
      <FloatingSop />
      <CommandCenter />
      <GuidedTour />
    </div>
    </MonitoringProvider>
  );
}
