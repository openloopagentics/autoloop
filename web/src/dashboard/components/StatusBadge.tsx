import { statusColor } from "../status";

/* 24x24 stroke icons, colored via CSS (.badge .ico path { stroke: var(--c) }) */
const ICONS: Record<string, JSX.Element> = {
  queued: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  blocked: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4" /><path d="M12 17.2v.2" /></svg>,
  paused: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round"><line x1="9" y1="6" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="18" /></svg>,
  completed: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5 10 18 20 6" /></svg>,
  failed: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>,
  cancelled: <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><line x1="6.5" y1="6.5" x2="17.5" y2="17.5" /></svg>,
};

export function StatusBadge({ status }: { status: string }) {
  const lead = status === "running"
    ? <span className="dot" aria-hidden="true" />
    : (ICONS[status] ?? null);
  // The label span carries `data-color` (consumed by tests + as a hook); the
  // visible text stays the raw lowercase status, styled `capitalize` via CSS.
  return (
    <span className={`badge s-${status}`}>
      {lead}
      <span data-color={statusColor(status)}>{status}</span>
    </span>
  );
}
