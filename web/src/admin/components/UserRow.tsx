import type { AdminUser } from "../types";
export function UserRow({ user, onSetAllowed }: { user: AdminUser; onSetAllowed: (uid: string, next: boolean) => void }) {
  return (
    <li className="user-row">
      <span>{user.email ?? user.uid}</span>
      {user.isAdmin && <span className="badge">admin</span>}
      <span>{user.isAllowed ? "allowed" : "not allowed"}</span>
      <button onClick={() => onSetAllowed(user.uid, !user.isAllowed)}>
        {user.isAllowed ? "Revoke" : "Allow"}
      </button>
    </li>
  );
}
