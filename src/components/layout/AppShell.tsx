import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { QuickActionsRail } from "./QuickActionsRail";
import { AssistantWidget } from "@/components/AssistantWidget";
import { FloatingSop } from "@/components/FloatingSop";
import { GuideCard } from "@/components/GuideCard";
import { CommandPalette } from "@/components/CommandPalette";
import { GuidedTour } from "@/components/GuidedTour";

export function AppShell() {
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onMenu={() => setMobileNav(true)} />
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
      <CommandPalette />
      <GuidedTour />
    </div>
  );
}
