import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuth } from "./auth/context";
import { SignIn } from "./routes/SignIn";
import { RequestAccess } from "./routes/RequestAccess";
import { AppShell } from "./routes/AppShell";
import { Home } from "./routes/Home";

function ComingSoon() {
  return <p>Coming soon.</p>;
}

export function App() {
  const { state } = useAuth();
  if (state === "loading") return <p role="status">Loading…</p>;
  if (state === "signed-out") return <SignIn />;
  if (state === "pending") return <RequestAccess />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<ComingSoon />} />
          <Route path="teams" element={<ComingSoon />} />
          <Route path="keys" element={<ComingSoon />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
