import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./auth/context";
import { SignIn } from "./routes/SignIn";
import { RequestAccess } from "./routes/RequestAccess";
import { AppShell } from "./routes/AppShell";
import { DashboardHome } from "./dashboard/DashboardHome";
import { ProjectDetail } from "./dashboard/ProjectDetail";
import { TeamsPage } from "./teams/TeamsPage";
import { KeysPage } from "./keys/KeysPage";
import { AdminPage } from "./admin/AdminPage";
import { GettingStarted } from "./routes/GettingStarted";
import { LoopMark } from "./ui/LoopMark";

export function App() {
  const { state } = useAuth();
  if (state === "loading") return (
    <div className="auth-stage" role="status">
      <div className="auth-loading">
        <LoopMark size={40} />
        <span className="auth-loading-text">Connecting to the live board…</span>
      </div>
    </div>
  );
  if (state === "signed-out") return <SignIn />;
  if (state === "pending") return <RequestAccess />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="getting-started" element={<GettingStarted />} />
          <Route path="dashboard" element={<DashboardHome />} />
          <Route path="dashboard/:teamId/:slug" element={<ProjectDetail />} />
          <Route path="dashboard/:teamId/:slug/:tab" element={<ProjectDetail />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="keys" element={<KeysPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
