import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Loading, Shell } from "@/components/Shell";
import Login from "@/pages/Login";
import Sso from "@/pages/Sso";
import Home from "@/pages/Home";
import PathPage from "@/pages/PathPage";
import Player from "@/pages/Player";
import Exam from "@/pages/Exam";
import { CertificateList, CertificateView } from "@/pages/Certificates";
import { CourseList, Reports, Reviews, StudioOverview } from "@/pages/studio/Studio";
import CourseEditor from "@/pages/studio/CourseEditor";
import { PathEditor, PathList } from "@/pages/studio/Paths";
import Learners from "@/pages/studio/Learners";
import Settings from "@/pages/studio/Settings";

function StaffOnly({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { isStaff, isAdmin } = useAuth();
  if (admin ? !isAdmin : !isStaff) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { session, me, loading, signOut } = useAuth();
  const { pathname } = useLocation();

  if (pathname === "/sso") return <Sso />;
  if (loading) return <Loading />;
  if (!session) return <Login />;
  if (session && me && !me.role) {
    // Signed in, but not a member of a MadeEA workspace (e.g. a client portal account).
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-sm p-6 text-center">
          <p className="font-semibold">The Academy is for the MadeEA team</p>
          <p className="mt-1 text-sm text-muted">This account ({me.email}) isn't part of a MadeEA workspace.</p>
          <button className="btn mt-4" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!me) return <Loading />;

  return (
    <Routes>
      {/* Focus mode: no site chrome around the content. */}
      <Route path="/learn/:courseId" element={<Player />} />
      <Route path="/exam/:pathId" element={<Exam />} />
      <Route path="/studio/courses/:courseId/preview" element={<StaffOnly><Player preview /></StaffOnly>} />
      <Route path="*" element={
        <Shell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/paths/:id" element={<PathPage />} />
            <Route path="/certificates" element={<CertificateList />} />
            <Route path="/certificate/:code" element={<CertificateView />} />
            <Route path="/studio" element={<StaffOnly><StudioOverview /></StaffOnly>} />
            <Route path="/studio/courses" element={<StaffOnly><CourseList /></StaffOnly>} />
            <Route path="/studio/courses/:id" element={<StaffOnly><CourseEditor /></StaffOnly>} />
            <Route path="/studio/paths" element={<StaffOnly><PathList /></StaffOnly>} />
            <Route path="/studio/paths/:id" element={<StaffOnly><PathEditor /></StaffOnly>} />
            <Route path="/studio/learners" element={<StaffOnly><Learners /></StaffOnly>} />
            <Route path="/studio/reports" element={<StaffOnly><Reports /></StaffOnly>} />
            <Route path="/studio/reviews" element={<StaffOnly><Reviews /></StaffOnly>} />
            <Route path="/studio/settings" element={<StaffOnly admin><Settings /></StaffOnly>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      } />
    </Routes>
  );
}
