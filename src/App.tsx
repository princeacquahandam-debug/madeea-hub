import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Tasks from "@/pages/Tasks";
import Communication from "@/pages/Communication";
import QuickActions from "@/pages/QuickActions";
import ClientVault from "@/pages/ClientVault";
import AutomationPage from "@/pages/Automation";
import Integrations from "@/pages/Integrations";
import CommunicationStudio from "@/pages/CommunicationStudio";
import BookkeepingAI from "@/pages/BookkeepingAI";

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
        <Route path="/automation" element={<AutomationPage />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/studio" element={<CommunicationStudio />} />
        <Route path="/bookkeeping" element={<BookkeepingAI />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
