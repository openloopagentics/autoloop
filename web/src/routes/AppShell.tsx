import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/context";
import { LoopMark } from "../ui/LoopMark";
import { NotificationsBell } from "../notifications/NotificationsBell";
import { THEMES, getTheme, applyTheme } from "../ui/theme";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/teams", label: "Teams" },
  { to: "/keys", label: "API keys" },
];

export function AppShell() {
  const { user, isAdmin, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [theme, setTheme] = useState(getTheme);
  const profileRef = useRef<HTMLDivElement>(null);

  const pickTheme = (id: string) => { applyTheme(id); setTheme(id); };
  const items = isAdmin ? [...NAV, { to: "/admin", label: "Admin" }] : NAV;

  // close the profile menu on outside-click / Escape
  useEffect(() => {
    if (!profileOpen) return;
    const onDown = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setProfileOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [profileOpen]);

  const initial = (user?.email?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div className="app">
      <header className="hdr">
        <NavLink to="/dashboard" className="brand">
          <LoopMark size={24} />
          <span className="wordmark">autoloop</span>
        </NavLink>

        <nav className="nav nav--desktop">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {it.label}
            </NavLink>
          ))}
        </nav>

        <div className="spacer" />

        <div className="hdr-actions hdr-actions--desktop">
          <NavLink to="/getting-started" className="help-link">Getting started</NavLink>

          <NotificationsBell />

          <div className="profile" ref={profileRef}>
            <button
              className="avatar-btn"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((v) => !v)}
            >
              <span className="avatar">{initial}</span>
              <svg className={`caret${profileOpen ? " open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {profileOpen && (
              <div className="menu">
                <div className="menu-head">
                  <span className="menu-label">Signed in as</span>
                  <span className="menu-email">{user?.email}</span>
                </div>
                <hr className="rule" />
                <div className="menu-label menu-label--inset">Theme</div>
                <div className="theme-grid">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`theme-opt${theme === t.id ? " theme-opt--active" : ""}`}
                      aria-pressed={theme === t.id}
                      onClick={() => pickTheme(t.id)}
                    >
                      <span className="theme-dot" style={{ background: t.swatch }} />
                      {t.label}
                    </button>
                  ))}
                </div>
                <hr className="rule" />
                <NavLink to="/getting-started" className="menu-item" onClick={() => setProfileOpen(false)}>Getting started</NavLink>
                <button className="menu-item menu-item--danger" onClick={() => void signOut()}>Sign out</button>
              </div>
            )}
          </div>
        </div>

        <button className="btn-text nav-toggle" aria-label="Menu" onClick={() => setNavOpen((v) => !v)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="3" y1="7" x2="21" y2="7" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="17" x2="21" y2="17" /></svg>
        </button>

        {navOpen && (
          <div className="nav-sheet" onClick={() => setNavOpen(false)}>
            {items.map((it) => (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => (isActive ? "active" : "")}>
                {it.label}
              </NavLink>
            ))}
            <NavLink to="/getting-started">Getting started</NavLink>
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
