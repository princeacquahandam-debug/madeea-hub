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
const CommunicationStudio = lazy(() => import("@/pages/CommunicationStudio"));
const BookkeepingAI = lazy(() => import("@/pages/BookkeepingAI"));
const Settings = lazy(() => import("@/pages/Settings"));
const Admin = lazy(() => import("@/pages/Admin"));
const Changelog = lazy(() => import("@/pages/Changelog"));
const EmailHelper = lazy(() => import("@/pages/EmailHelper"));
const MeetingHelper = lazy(() => import("@/pages/MeetingHelper"));
const Focus = lazy(() => import("@/pages/Focus"));
const VoiceNotes = lazy(() => import("@/pages/VoiceNotes"));
const DailyBriefing = lazy(() => import("@/pages/DailyBriefing"));
const MemoryHelper = lazy(() => import("@/pages/MemoryHelper"));
const DecisionHelper = lazy(() => import("@/pages/DecisionHelper"));
const Homework = lazy(() => import("@/pages/Homework"));
const InvestorUpdate = lazy(() => import("@/pages/InvestorUpdate"));
const Scoreboard = lazy(() => import("@/pages/Scoreboard"));
const Travel = lazy(() => import("@/pages/Travel"));
const Notes = lazy(() => import("@/pages/Notes"));
const Academy = lazy(() => import("@/pages/Academy"));

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
        <Route path="/communication" element={<Communication />} />
        <Route path="/quick-actions" element={<QuickActions />} />
        <Route path="/clients" element={<ClientVault />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/sops" element={<Sops />} />
        <Route path="/automation" element={<AutomationPage />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/studio" element={<CommunicationStudio />} />
        <Route path="/bookkeeping" element={<BookkeepingAI />} />
        <Route path="/email-helper" element={<EmailHelper />} />
        <Route path="/meeting-helper" element={<MeetingHelper />} />
        <Route path="/focus" element={<Focus />} />
        {/* Second Brain */}
        <Route path="/voice-notes" element={<VoiceNotes />} />
        <Route path="/briefing" element={<DailyBriefing />} />
        <Route path="/memory" element={<MemoryHelper />} />
        <Route path="/decision" element={<DecisionHelper />} />
        <Route path="/homework" element={<Homework />} />
        <Route path="/investor-update" element={<InvestorUpdate />} />
        <Route path="/scoreboard" element={<Scoreboard />} />
        <Route path="/travel" element={<Travel />} />
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
