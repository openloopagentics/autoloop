import type { Invite } from "../types";
export function InviteRow({ invite, onRevoke }: { invite: Invite; onRevoke: (i: Invite) => void }) {
  return (
    <li className="sent-invite" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "6px 0" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--fg-meta)" }} aria-hidden="true"><path d="M2 6l10 7L22 6" /><rect x="2" y="5" width="20" height="14" rx="2" /></svg>
      <span style={{ color: "var(--fg-body)" }}>{invite.email}</span>
      <span className="role">{invite.role}</span>
      <span className="dim" style={{ flex: 1 }}>invite sent</span>
      <button className="btn-text" style={{ color: "var(--fg-soft)" }} onClick={() => onRevoke(invite)}>Revoke</button>
    </li>
  );
}
