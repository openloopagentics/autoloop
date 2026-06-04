/* shell.jsx — shared utils, header/nav, app chrome. */

// ---- time helpers ----
function useNow(intervalMs = 1000) {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => force(n => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return Date.now();
}
function timeAgo(date) {
  if (!date) return "—";
  const s = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return s + "s ago";
  const mn = Math.floor(s / 60); if (mn < 60) return mn + "m ago";
  const hr = Math.floor(mn / 60); if (hr < 24) return hr + "h ago";
  const dy = Math.floor(hr / 24); if (dy < 30) return dy + "d ago";
  return Math.floor(dy / 30) + "mo ago";
}
function fmtDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
// duration between two times (or to now if open), compact
function fmtDuration(start, end) {
  if (!start) return "—";
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  const dy = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), mn = Math.floor((s % 3600) / 60), sec = s % 60;
  if (dy > 0) return dy + "d " + hr + "h";
  if (hr > 0) return hr + "h " + mn + "m";
  if (mn > 0) return mn + "m " + sec + "s";
  return sec + "s";
}

function useCopy() {
  const [copied, setCopied] = React.useState(null);
  const copy = (text, key) => {
    try { navigator.clipboard.writeText(text); } catch (e) {}
    setCopied(key || text);
    setTimeout(() => setCopied(null), 1400);
  };
  return [copied, copy];
}

// current phase = lowest-order phase that isn't terminal/finished
function currentPhase(project) {
  const open = project.phases.filter(p => !["completed", "cancelled"].includes(p.status));
  if (open.length) return open.sort((a, b) => a.order - b.order)[0];
  return project.phases[project.phases.length - 1];
}

// ---- header / nav ----
function Header({ route, go, user, onSignOut }) {
  const items = [
    { id: "home", label: "Home" },
    { id: "dashboard", label: "Dashboard" },
    { id: "teams", label: "Teams" },
    { id: "keys", label: "API keys" },
  ];
  if (user.admin) items.push({ id: "admin", label: "Admin" });
  const active = route.name === "project" ? "dashboard" : route.name;
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <header className="hdr">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); go({ name: "home" }); }}>
        <LoopMark size={24} />
        <span className="wordmark">daloop</span>
      </a>

      <nav className="nav nav--desktop">
        {items.map(it => (
          <a key={it.id} href="#" className={active === it.id ? "active" : ""}
             onClick={e => { e.preventDefault(); go({ name: it.id }); }}>{it.label}</a>
        ))}
      </nav>

      <div className="spacer"></div>

      <div className="hdr-user hdr-user--desktop">
        <span className="email">{user.email}</span>
        <button className="btn-text" onClick={onSignOut}>Sign out</button>
      </div>

      <button className="btn-text nav-toggle" aria-label="Menu" onClick={() => setMenuOpen(v => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
      </button>

      {menuOpen && (
        <div className="nav-sheet" onClick={() => setMenuOpen(false)}>
          {items.map(it => (
            <a key={it.id} href="#" className={active === it.id ? "active" : ""}
               onClick={e => { e.preventDefault(); go({ name: it.id }); setMenuOpen(false); }}>{it.label}</a>
          ))}
          <hr className="rule" />
          <span className="email">{user.email}</span>
          <button className="btn-text" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}

Object.assign(window, { useNow, timeAgo, fmtDate, fmtTime, fmtDuration, useCopy, currentPhase, Header });
