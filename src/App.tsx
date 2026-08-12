import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { CommandCenterProvider } from "@/hooks/useCommandCenter";
import { AppShell } from "@/components/layout/AppShell";
// Login and Dashboard are eager: Login is the gate before the shell, and
// Dashboard is the "/" landing route — keeping it eager means the first paint
// never suspends (instant, no shimmer flash on cold load).
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";

// Every other routed page is code-split into its own chunk, so the first load
// only downloads the shell + Dashboard instead of one ~1MB bundle. While a
// chunk streams in, AppShell's Suspense boundary shows the shimmer skeleton.
const Tasks = lazy(() => import("@/pages/Tasks"));
const EodReports = lazy(() => import("@/pages/EodReports"));
const Communication = lazy(() => import("@/pages/Communication"));
const QuickActions = lazy(() => import("@/pages/QuickActions"));
const ClientVault = lazy(() => import("@/pages/ClientVault"));
const Sops = lazy(() => import("@/pages/Sops"));
const AutomationPage = lazy(() => import("@/pages/Automation"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const Settings = lazy(() => import("@/pages/Settings"));
const Admin = lazy(() => import("@/pages/Admin"));
const Changelog = lazy(() => import("@/pages/Changelog"));
/* Deliberately NOT imported — see the notes beside the routes below. Every one
   of these pages is still in src/pages; only the route and the nav entry are
   gone, so restoring one is two lines.

   10 Aug audit §7:  Focus, VoiceNotes, MemoryHelper, DecisionHelper, Homework
   09 Aug direction: CommunicationStudio, BookkeepingAI, InvestorUpdate, Travel,
                     EmailHelper, MeetingHelper, DailyBriefing               */
const Scoreboard = lazy(() => import("@/pages/Scoreboard"));
const Time = lazy(() => import("@/pages/Time"));
const Videos = lazy(() => import("@/pages/Videos"));
const Notes = lazy(() => import("@/pages/Notes"));
const Academy = lazy(() => import("@/pages/Academy"));
const MeetingIntelligence = lazy(() => import("@/pages/MeetingIntelligence"));

const queryClient = new QueryClient();

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-faint">Loading…</div>;
  }
  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/academy" element={<Academy />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/eod" element={<EodReports />} />
        <Route path="/time" element={<Time />} />
        <Route path="/communication" element={<Communication />} />
        <Route path="/meeting-intelligence" element={<MeetingIntelligence />} />
        <Route path="/quick-actions" element={<QuickActions />} />
        <Route path="/clients" element={<ClientVault />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/sops" element={<Sops />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/automation" element={<AutomationPage />} />
        <Route path="/integrations" element={<Integrations />} />
        {/* Unmounted, not merely de-navved — a nav-only removal leaves the URL
            working. Reasoning for each sits beside the nav list in
            lib/constants.ts.

            10 Aug audit §7:  /focus /voice-notes /memory /decision /homework
            09 Aug direction: /studio /bookkeeping /investor-update /travel
                              /email-helper /meeting-helper /briefing

            /scoreboard stays: it is to be repurposed as the client proof
            surface, which is a build rather than a cut. */}
        <Route path="/scoreboard" element={<Scoreboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter
          basename={import.meta.env.BASE_URL}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          {/* CommandCenterProvider needs the router (navigation) + query client
              (data), so it sits inside BrowserRouter and wraps the app. */}
          <CommandCenterProvider>
            <Gate />
          </CommandCenterProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
