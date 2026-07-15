import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { QuickActionsRail } from "./QuickActionsRail";
import { AssistantWidget } from "@/components/AssistantWidget";
import { FloatingSop } from "@/components/FloatingSop";
import { GuideCard } from "@/components/GuideCard";
import { CommandCenter } from "@/components/command-center";
import { GuidedTour } from "@/components/GuidedTour";
import { useUI } from "@/store/ui";

export function AppShell() {
  const { navOpen, setNavOpen } = useUI();

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onMenu={() => setNavOpen(true)} />
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <GuideCard />
            <Outlet />
          </main>
          <QuickActionsRail />
        </div>
      </div>

      <AssistantWidget />
      <FloatingSop />
      <CommandCenter />
      <GuidedTour />
    </div>
  );
}
