import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/context";

export function AppShell() {
  const { user, signOut } = useAuth();
  return (
    <div>
      <header>
        <span>Daloop</span>
        <nav>
          <NavLink to="/">Home</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/teams">Teams</NavLink>
          <NavLink to="/keys">API Keys</NavLink>
        </nav>
        <span>{user?.email}</span>
        <button onClick={() => void signOut()}>Sign out</button>
      </header>
      <main><Outlet /></main>
    </div>
  );
}
