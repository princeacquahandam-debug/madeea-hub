import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { CommandCenterProvider } from "@/hooks/useCommandCenter";
import { AppShell } from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Tasks from "@/pages/Tasks";
import Communication from "@/pages/Communication";
import QuickActions from "@/pages/QuickActions";
import ClientVault from "@/pages/ClientVault";
import Sops from "@/pages/Sops";
import AutomationPage from "@/pages/Automation";
import Integrations from "@/pages/Integrations";
import CommunicationStudio from "@/pages/CommunicationStudio";
import BookkeepingAI from "@/pages/BookkeepingAI";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import Changelog from "@/pages/Changelog";
import EmailHelper from "@/pages/EmailHelper";
import MeetingHelper from "@/pages/MeetingHelper";
import Focus from "@/pages/Focus";
import VoiceNotes from "@/pages/VoiceNotes";
import DailyBriefing from "@/pages/DailyBriefing";
import MemoryHelper from "@/pages/MemoryHelper";
import DecisionHelper from "@/pages/DecisionHelper";
import Homework from "@/pages/Homework";
import InvestorUpdate from "@/pages/InvestorUpdate";
import Scoreboard from "@/pages/Scoreboard";
import Travel from "@/pages/Travel";

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
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/communication" element={<Communication />} />
        <Route path="/quick-actions" element={<QuickActions />} />
        <Route path="/clients" element={<ClientVault />} />
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
        <BrowserRouter basename={import.meta.env.BASE_URL}>
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
