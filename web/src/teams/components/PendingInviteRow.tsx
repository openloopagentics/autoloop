import type { Invite } from "../types";
export function PendingInviteRow({ invite, onAccept, onDecline }: {
  invite: Invite; onAccept: (i: Invite) => void; onDecline: (i: Invite) => void;
}) {
  return (
    <li className="pending-invite">
      <span>Invite to a team as {invite.role}</span>
      <button onClick={() => onAccept(invite)}>Accept</button>
      <button onClick={() => onDecline(invite)}>Decline</button>
    </li>
  );
}
