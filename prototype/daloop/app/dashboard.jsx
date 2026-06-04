/* dashboard.jsx — Home (command center) + Dashboard board + ProjectCard. */

// mini phase stepper shown inside a project card
function PhaseStepperMini({ project }) {
  const cur = currentPhase(project);
  return (
    <div className="stepmini" aria-hidden="true">
      {project.phases.map((p, i) => {
        const isCur = p.id === cur.id && !["completed", "cancelled"].includes(p.status);
        return (
          <React.Fragment key={p.id}>
            {i > 0 && <span className={"stepmini-bar " + (["completed"].includes(project.phases[i - 1].status) ? "done" : "")}></span>}
            <span className={"stepmini-node s-" + p.status + (isCur ? " cur" : "")} title={p.name + " · " + STATUS[p.status].label}>
              {p.status === "completed" && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17.5 19 6.5"/></svg>}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ProjectCard({ project, team, onOpen, style }) {
  const cur = currentPhase(project);
  const lastCommit = project.phases.flatMap(p => p.commits).sort((a, b) => (new Date(b.at) - new Date(a.at)) || (a.sha < b.sha ? 1 : -1))[0];
  const doneCount = project.phases.filter(p => p.status === "completed").length;
  const attention = ["blocked", "failed"].includes(project.status);

  return (
    <a href="#" className={"pcard card" + (attention ? " pcard--alarm" : "") + (style === "compact" ? " pcard--compact" : "")}
       onClick={e => { e.preventDefault(); onOpen(project, team); }}>
      <div className="pcard-top">
        <h3 className="pcard-title">{project.title}</h3>
        <StatusBadge status={project.status} size="sm" />
      </div>

      <PhaseStepperMini project={project} />

      <div className="pcard-phase">
        <span className="pcard-phase-name">{cur.name}</span>
        <span className="pcard-phase-meta">
          {["completed", "cancelled"].includes(project.status)
            ? <>{doneCount}/{project.phases.length} phases</>
            : <>phase {cur.order}/{project.phases.length}</>}
        </span>
      </div>

      {lastCommit && style !== "compact" && (
        <div className="pcard-commit">
          <StatusDot status={cur.status} />
          <span className="pcard-commit-msg mono">{lastCommit.message}</span>
        </div>
      )}

      <div className="pcard-foot">
        <span className="pcard-slug mono">{project.slug}</span>
        <span className="pcard-updated tnum">updated {timeAgo(project.updatedAt)}</span>
      </div>
    </a>
  );
}

// ---------- Dashboard (grouped by team) ----------
function DashboardScreen({ user, go }) {
  useNow(1000); // keep "updated Xs ago" live
  const [cardStyle, setCardStyle] = React.useState(window.__daloopCardStyle || "detailed");
  React.useEffect(() => {
    const h = () => setCardStyle(window.__daloopCardStyle || "detailed");
    window.addEventListener("daloop-tweak", h); return () => window.removeEventListener("daloop-tweak", h);
  }, []);
  const teams = SEED.teams;
  const open = (p, t) => go({ name: "project", team: t.id, project: p.slug });

  if (!teams.length) return (
    <div className="main"><div className="page-head"><h1 className="page-title">Dashboard</h1></div>
      <div className="empty card" style={{ padding: 40, textAlign: "center" }}>You're not on a team yet.</div></div>
  );

  return (
    <div className="main">
      <div className="page-head dash-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Live across {teams.length} teams · streaming from agents</p>
        </div>
        <span className="live-pill"><span className="sdot s-running is-live"></span> live</span>
      </div>

      {teams.map(team => {
        const projects = SEED.projects.filter(p => p.teamId === team.id);
        return (
          <section key={team.id} className="team-section">
            <div className="team-section-head">
              <h2 className="team-name">{team.name}</h2>
              <span className="team-meta">
                <span className={"role" + (team.myRole === "owner" ? " owner" : "")}>{team.myRole}</span>
                <span className="dim">·</span>
                <span className="dim">{projects.length} project{projects.length !== 1 ? "s" : ""}</span>
              </span>
            </div>
            {projects.length ? (
              <div className="pgrid">
                {projects.map(p => <ProjectCard key={p.id} project={p} team={team} onOpen={open} style={cardStyle} />)}
              </div>
            ) : (
              <div className="empty">No projects yet.</div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Home (command center) ----------
function HomeScreen({ user, go }) {
  useNow(1000);
  const projects = SEED.projects;
  const counts = {};
  STATUS_ORDER.forEach(s => counts[s] = projects.filter(p => p.status === s).length);
  const attention = projects.filter(p => ["blocked", "failed"].includes(p.status));
  const running = projects.filter(p => p.status === "running");

  // live activity: latest commits across everything (stable sort: tiebreak by sha)
  const feed = projects.flatMap(p =>
    p.phases.flatMap(ph => ph.commits.map(c => ({ ...c, project: p, phase: ph })))
  ).sort((a, b) => (new Date(b.at) - new Date(a.at)) || (a.sha < b.sha ? 1 : -1)).slice(0, 14);

  // only animate genuinely-new arrivals (prime the seen-set on first render)
  const seen = React.useRef(null);
  if (seen.current === null) seen.current = new Set(feed.map(c => c.sha));
  const freshNow = feed.filter(c => !seen.current.has(c.sha)).map(c => c.sha);
  React.useEffect(() => { feed.forEach(c => seen.current.add(c.sha)); });

  const teamOf = id => SEED.teams.find(t => t.id === id);
  const openP = p => go({ name: "project", team: p.teamId, project: p.slug });
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="main">
      <div className="page-head">
        <h1 className="page-title">{greet}, {user.name.split(" ")[0]}.</h1>
        <p className="page-sub">{projects.length} projects across {SEED.teams.length} teams. Here's the pulse.</p>
      </div>

      {/* health strip */}
      <div className="health-strip">
        {STATUS_ORDER.map(s => (
          <div key={s} className={"health-tile" + (counts[s] === 0 ? " is-zero" : "")}>
            <div className="health-top"><StatusDot status={s} /><span className="health-count tnum">{counts[s]}</span></div>
            <span className="health-label">{STATUS[s].label}</span>
          </div>
        ))}
      </div>

      <div className="home-cols">
        {/* attention */}
        <section className="home-col">
          <div className="col-head">
            <h2 className="col-title">Needs attention</h2>
            <span className="col-count tnum">{attention.length}</span>
          </div>
          {attention.length ? attention.map(p => (
            <a key={p.id} href="#" className="attn-row card" onClick={e => { e.preventDefault(); openP(p); }}>
              <StatusDot status={p.status} />
              <div className="attn-body">
                <div className="attn-title">{p.title}</div>
                <div className="attn-meta">{teamOf(p.teamId).name} · {currentPhase(p).name}</div>
              </div>
              <StatusBadge status={p.status} size="sm" />
            </a>
          )) : <div className="empty">Nothing needs you. All clear.</div>}

          {running.length > 0 && <>
            <div className="col-head" style={{ marginTop: "var(--section-gap)" }}>
              <h2 className="col-title">Running now</h2>
              <span className="col-count tnum">{running.length}</span>
            </div>
            {running.map(p => (
              <a key={p.id} href="#" className="attn-row card" onClick={e => { e.preventDefault(); openP(p); }}>
                <StatusDot status="running" />
                <div className="attn-body">
                  <div className="attn-title">{p.title}</div>
                  <div className="attn-meta">{teamOf(p.teamId).name} · {currentPhase(p).name} · {fmtDuration(currentPhase(p).startedAt)}</div>
                </div>
                <svg className="attn-go" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              </a>
            ))}
          </>}
        </section>

        {/* live activity feed */}
        <section className="home-col">
          <div className="col-head">
            <h2 className="col-title">Live activity</h2>
            <span className="live-pill"><span className="sdot s-running is-live"></span> live</span>
          </div>
          <div className="feed card">
            {feed.map((c, i) => (
              <a key={c.sha} href="#" className={"feed-row" + (freshNow.includes(c.sha) ? " feed-row--new" : "")} onClick={e => { e.preventDefault(); openP(c.project); }}>
                <StatusDot status={c.phase.status} />
                <div className="feed-body">
                  <span className="feed-msg mono">{c.message}</span>
                  <span className="feed-meta">{c.project.title} · {c.author} · {timeAgo(c.at)}</span>
                </div>
                <code className="feed-sha mono">{c.sha.slice(0, 7)}</code>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { ProjectCard, PhaseStepperMini, DashboardScreen, HomeScreen });
