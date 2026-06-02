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
    <li className="member">
      <div className="member-id">
        <span className="member-name">
          {member.email ?? member.uid}
          {isSelf && <span className="you-tag">you</span>}
        </span>
        {member.email && <span className="member-email mono">{member.uid}</span>}
      </div>
      {canManage ? (
        <>
          <select className="select select-sm" aria-label={`role for ${member.uid}`} value={member.role}
            onChange={(e) => onChangeRole(member.uid, e.target.value as Role)}>
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="btn-danger btn btn-sm" onClick={() => onRemove(member.uid)}>Remove</button>
        </>
      ) : (
        <span className={`role${member.role === "owner" ? " owner" : ""}`}>{member.role}</span>
      )}
      {isSelf && <button className="btn-ghost btn btn-sm" onClick={() => onRemove(member.uid)}>Leave</button>}
    </li>
  );
}
