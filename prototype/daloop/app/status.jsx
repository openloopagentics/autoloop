/* status.jsx — the backbone: 7-status config, badges, dots, and the brand mark. */

// 24x24 stroke icons, colored via CSS (.badge .ico path { stroke: var(--c) })
const StIcon = {
  queued: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>,
  blocked: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4"/><path d="M12 17.2v.2"/></svg>,
  paused: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round"><line x1="9" y1="6" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="18"/></svg>,
  completed: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5 10 18 20 6"/></svg>,
  failed: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>,
  cancelled: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="8.5"/><line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/></svg>,
};

const STATUS = {
  queued:    { label: "Queued",    group: "waiting",  desc: "Waiting to start" },
  running:   { label: "Running",   group: "active",   desc: "In progress now" },
  blocked:   { label: "Blocked",   group: "alarm",    desc: "Needs attention" },
  paused:    { label: "Paused",    group: "waiting",  desc: "On hold" },
  completed: { label: "Completed", group: "terminal", desc: "Done" },
  failed:    { label: "Failed",    group: "alarm",    desc: "Ended in failure" },
  cancelled: { label: "Cancelled", group: "terminal", desc: "Stopped, won't resume" },
};
const STATUS_ORDER = ["queued", "running", "blocked", "paused", "completed", "failed", "cancelled"];

function StatusBadge({ status, size }) {
  const s = STATUS[status] || STATUS.queued;
  const lead = status === "running"
    ? <span className="dot" aria-hidden="true"></span>
    : (StIcon[status] || null);
  return (
    <span className={"badge s-" + status} role="status" style={size === "sm" ? { fontSize: 10.5, padding: "2px 8px 2px 7px" } : null}>
      {lead}
      <span>{s.label}</span>
    </span>
  );
}

function StatusDot({ status, live }) {
  return <span className={"sdot s-" + status + (status === "running" || live ? " is-live" : "")} title={(STATUS[status] || {}).label} aria-label={(STATUS[status] || {}).label}></span>;
}

// Daloop loop monogram — a live cycle: near-closed ring with an arrowhead + a
// pulsing core, evoking "built in a loop" and "live".
function LoopMark({ size = 24, live = true }) {
  const s = size;
  return (
    <svg className="loop" viewBox="0 0 24 24" width={s} height={s} fill="none" aria-hidden="true"
         style={{ display: "block" }}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round"/>
      <path d="M20 4.4V8.2H16.2" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="2.6" fill="var(--brand)"/>
      {live && <circle className="loop-core" cx="12" cy="12" r="2.6" fill="var(--brand)" />}
    </svg>
  );
}

Object.assign(window, { STATUS, STATUS_ORDER, StatusBadge, StatusDot, LoopMark, StIcon });
