import type { Invite } from "../types";
export function InviteRow({ invite, onRevoke }: { invite: Invite; onRevoke: (i: Invite) => void }) {
  return (
    <li className="invite-row">
      <span>{invite.email}</span> <span className="role">{invite.role}</span>
      <button onClick={() => onRevoke(invite)}>Revoke</button>
    </li>
  );
}
