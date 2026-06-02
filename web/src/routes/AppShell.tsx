import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/context";
import { LoopMark } from "../ui/LoopMark";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/teams", label: "Teams" },
  { to: "/keys", label: "API keys" },
];

export function AppShell() {
  const { user, isAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = isAdmin ? [...NAV, { to: "/admin", label: "Admin" }] : NAV;

  return (
    <div className="app">
      <header className="hdr">
        <NavLink to="/dashboard" className="brand">
          <LoopMark size={24} />
          <span className="wordmark">daloop</span>
        </NavLink>

        <nav className="nav nav--desktop">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {it.label}
            </NavLink>
          ))}
        </nav>

        <div className="spacer" />

        <div className="hdr-user hdr-user--desktop">
          <span className="email">{user?.email}</span>
          <button className="btn-text" onClick={() => void signOut()}>Sign out</button>
        </div>

        <button className="btn-text nav-toggle" aria-label="Menu" onClick={() => setMenuOpen((v) => !v)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="3" y1="7" x2="21" y2="7" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="17" x2="21" y2="17" /></svg>
        </button>

        {menuOpen && (
          <div className="nav-sheet" onClick={() => setMenuOpen(false)}>
            {items.map((it) => (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => (isActive ? "active" : "")}>
                {it.label}
              </NavLink>
            ))}
            <hr className="rule" />
            <span className="email">{user?.email}</span>
            <button className="btn-text" onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
      </header>

      <Outlet />
    </div>
  );
}
