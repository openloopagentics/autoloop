import type { Member, Role } from "../types";

export function MemberRow(props: {
  member: Member; viewerRole: Role; selfUid: string;
  onChangeRole: (uid: string, role: Role) => void;
  onRemove: (uid: string) => void;
}) {
  const { member, viewerRole, selfUid, onChangeRole, onRemove } = props;
  const isSelf = member.uid === selfUid;
  // Rank-aware: owner manages anyone (non-self); admin manages only `member` rows.
  const canManage = !isSelf && (viewerRole === "owner" || (viewerRole === "admin" && member.role === "member"));
  const roleOptions: Role[] = viewerRole === "owner" ? ["owner", "admin", "member"] : ["member"];
  return (
    <li className="member-row">
      <span>{member.email ?? member.uid}</span>
      <span className="role">{member.role}</span>
      {canManage && (
        <>
          <select aria-label={`role for ${member.uid}`} value={member.role}
            onChange={(e) => onChangeRole(member.uid, e.target.value as Role)}>
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => onRemove(member.uid)}>Remove</button>
        </>
      )}
      {isSelf && <button onClick={() => onRemove(member.uid)}>Leave</button>}
    </li>
  );
}
