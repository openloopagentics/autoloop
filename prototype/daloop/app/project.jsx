/* project.jsx — project detail: header + design doc + phase timeline + commits. */

// tiny markdown renderer (seed design docs only)
function mdToHtml(src) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');
  const lines = src.split("\n");
  let html = "", inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    let mm;
    if ((mm = line.match(/^###\s+(.*)/))) { closeList(); html += "<h4 class='md-h4'>" + inline(mm[1]) + "</h4>"; }
    else if ((mm = line.match(/^##\s+(.*)/))) { closeList(); html += "<h3 class='md-h3'>" + inline(mm[1]) + "</h3>"; }
    else if ((mm = line.match(/^-\s+\[([ x])\]\s+(.*)/))) {
      if (!inList) { html += "<ul class='md-checks'>"; inList = true; }
      const done = mm[1] === "x";
      html += "<li class='md-check" + (done ? " done" : "") + "'><span class='md-box'>" + (done ? "✓" : "") + "</span>" + inline(mm[2]) + "</li>";
    }
    else if ((mm = line.match(/^-\s+(.*)/))) {
      if (!inList) { html += "<ul class='md-list'>"; inList = true; }
      html += "<li>" + inline(mm[1]) + "</li>";
    }
    else { closeList(); html += "<p>" + inline(line) + "</p>"; }
  }
  closeList();
  return html;
}

function DesignDoc({ design }) {
  const [open, setOpen] = React.useState(true);
  if (!design) return null;
  if (design.type === "url") {
    return (
      <a href={design.content} target="_blank" rel="noopener" className="doc-link card">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
        <span className="doc-link-label">Design doc</span>
        <span className="doc-link-url mono">{design.content.replace(/^https?:\/\//, "")}</span>
        <svg className="doc-link-go" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
      </a>
    );
  }
  return (
    <div className="doc card">
      <button className="doc-head" onClick={() => setOpen(o => !o)}>
        <span className="eyebrow">Design doc</span>
        <svg className={"doc-chev" + (open ? " open" : "")} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && <div className="doc-body md" dangerouslySetInnerHTML={{ __html: mdToHtml(design.content) }} />}
    </div>
  );
}

// horizontal phase stepper
function PhaseStepper({ phases, current, selected, onSelect }) {
  return (
    <div className="stepper" role="tablist">
      {phases.map((p, i) => {
        const isCur = p.id === current.id;
        const isSel = p.id === selected;
        const prevDone = i > 0 && phases[i - 1].status === "completed";
        return (
          <button key={p.id} role="tab" aria-selected={isSel}
            className={"step s-" + p.status + (isSel ? " sel" : "") + (isCur ? " cur" : "")}
            onClick={() => onSelect(p.id)}>
            {i > 0 && <span className={"step-bar " + (prevDone ? "done" : "")}></span>}
            <span className="step-node">
              {p.status === "completed"
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17.5 19 6.5"/></svg>
                : p.status === "running" ? <span className="step-pulse"></span>
                : <span className="step-num tnum">{p.order}</span>}
            </span>
            <span className="step-label">
              <span className="step-name">{p.name}</span>
              <span className="step-status">{STATUS[p.status].label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Commit({ c, fresh }) {
  return (
    <div className={"commit" + (fresh ? " fade-up" : "")}>
      <code className="commit-sha mono">{c.sha.slice(0, 7)}</code>
      <span className="commit-msg mono">{c.message}</span>
      <span className="commit-author">{c.author}</span>
      <span className="commit-time tnum">{timeAgo(c.at)}</span>
    </div>
  );
}

function PhaseRow({ phase, current, expanded, onToggle }) {
  const isCur = phase.id === current.id && !["completed", "cancelled"].includes(phase.status);
  const seen = React.useRef(null);
  const sorted = phase.commits.slice().sort((a, b) => (new Date(b.at) - new Date(a.at)) || (a.sha < b.sha ? 1 : -1));
  if (seen.current === null) seen.current = new Set(sorted.map(c => c.sha));
  const freshSet = sorted.filter(c => !seen.current.has(c.sha)).map(c => c.sha);
  React.useEffect(() => { sorted.forEach(c => seen.current.add(c.sha)); });
  const timing = phase.status === "queued"
    ? "not started"
    : phase.startedAt
      ? (phase.endedAt
          ? fmtDate(phase.startedAt) + " → " + fmtDate(phase.endedAt) + " · " + fmtDuration(phase.startedAt, phase.endedAt)
          : "started " + fmtDate(phase.startedAt) + " · " + fmtDuration(phase.startedAt) + " elapsed")
      : "—";
  return (
    <div className={"phaserow card" + (isCur ? " phaserow--cur" : "")}>
      <button className="phaserow-head" onClick={onToggle} aria-expanded={expanded}>
        <span className={"sdot s-" + phase.status + (phase.status === "running" ? " is-live" : "")}></span>
        <span className="phaserow-name">{phase.name}</span>
        <StatusBadge status={phase.status} size="sm" />
        <span className="phaserow-timing">{timing}</span>
        <span className="phaserow-count tnum">{phase.commits.length} commit{phase.commits.length !== 1 ? "s" : ""}</span>
        <svg className={"phaserow-chev" + (expanded ? " open" : "")} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {expanded && (
        <div className="phaserow-body">
          {phase.commits.length
            ? <div className="commits">{sorted.map(c => <Commit key={c.sha} c={c} fresh={freshSet.includes(c.sha)} />)}</div>
            : <div className="empty" style={{ padding: "8px 4px" }}>No commits in this phase yet.</div>}
        </div>
      )}
    </div>
  );
}

function ProjectScreen({ route, go }) {
  useNow(1000);
  const team = SEED.teams.find(t => t.id === route.team);
  const project = SEED.projects.find(p => p.slug === route.project && p.teamId === route.team);
  if (!project) return <div className="main"><div className="empty card" style={{ padding: 40 }}>Project not found.</div></div>;

  const cur = currentPhase(project);
  const [selected, setSelected] = React.useState(cur.id);
  const [expanded, setExpanded] = React.useState(() => new Set([cur.id]));
  const toggle = id => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectStep = id => { setSelected(id); setExpanded(s => new Set(s).add(id));
    const el = document.getElementById("phr-" + id); if (el) el.classList.add("flash"), setTimeout(() => el.classList.remove("flash"), 700); };

  const totalCommits = project.phases.reduce((n, p) => n + p.commits.length, 0);

  return (
    <div className="main main--narrow">
      <a href="#" className="back" onClick={e => { e.preventDefault(); go({ name: "dashboard" }); }}>← back to dashboard</a>

      <div className="proj-head">
        <div className="proj-head-top">
          <div>
            <div className="proj-breadcrumb">{team.name}</div>
            <h1 className="proj-title serif">{project.title}</h1>
          </div>
          <StatusBadge status={project.status} />
        </div>
        <div className="proj-meta">
          <code className="chip">{project.slug}</code>
          <span className="dim">·</span>
          <span className="dim">{project.phases.length} phases</span>
          <span className="dim">·</span>
          <span className="dim">{totalCommits} commits</span>
          <span className="dim">·</span>
          <span className="dim">updated {timeAgo(project.updatedAt)}</span>
        </div>
      </div>

      <DesignDoc design={project.design} />

      <div className="proj-section-head">
        <h2 className="proj-section-title">Phases</h2>
      </div>

      {project.phases.length ? <>
        <PhaseStepper phases={project.phases} current={cur} selected={selected} onSelect={selectStep} />
        <div className="phaselist">
          {project.phases.map(p => (
            <div id={"phr-" + p.id} key={p.id}>
              <PhaseRow phase={p} current={cur} expanded={expanded.has(p.id)} onToggle={() => toggle(p.id)} />
            </div>
          ))}
        </div>
      </> : <div className="empty card" style={{ padding: 32 }}>No phases yet.</div>}
    </div>
  );
}

Object.assign(window, { ProjectScreen, mdToHtml, DesignDoc, PhaseStepper });
