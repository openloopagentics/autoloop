import type { AdminUser } from "../types";
export function UserRow({ user, onSetAllowed }: { user: AdminUser; onSetAllowed: (uid: string, next: boolean) => void }) {
  return (
    <li className="userrow">
      <div className="userrow-id">
        <span className="userrow-email">
          {user.email ?? user.uid}
          {user.isAdmin && <span className="admin-badge">admin</span>}
        </span>
        {user.email && <code className="userrow-uid mono">{user.uid}</code>}
      </div>
      <span className={`allow-state ${user.isAllowed ? "yes" : "no"}`}>
        <span className="sdot" style={{ background: user.isAllowed ? "var(--st-completed)" : "var(--st-cancelled)" }} />
        {user.isAllowed ? "allowed" : "not allowed"}
      </span>
      <button className={user.isAllowed ? "btn-danger btn btn-sm" : "btn btn-sm"}
        onClick={() => onSetAllowed(user.uid, !user.isAllowed)}>
        {user.isAllowed ? "Revoke" : "Allow"}
      </button>
    </li>
  );
}
