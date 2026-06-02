import type { Invite } from "../types";
export function PendingInviteRow({ invite, onAccept, onDecline }: {
  invite: Invite; onAccept: (i: Invite) => void; onDecline: (i: Invite) => void;
}) {
  return (
    <li className="invite-card card">
      <div className="invite-body">
        <span className="invite-team">Team invitation</span>
        <span className="invite-from">as <span className="role">{invite.role}</span></span>
      </div>
      <div className="invite-actions">
        <button className="btn btn-sm" onClick={() => onAccept(invite)}>Accept</button>
        <button className="btn-ghost btn btn-sm" onClick={() => onDecline(invite)}>Decline</button>
      </div>
    </li>
  );
}
