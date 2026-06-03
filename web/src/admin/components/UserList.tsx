import { UserRow } from "./UserRow";
import { EmptyState } from "../../dashboard/components/EmptyState";
import type { AdminUser } from "../types";
export function UserList({ users, onSetAllowed }: { users: AdminUser[]; onSetAllowed: (uid: string, next: boolean) => void }) {
  if (users.length === 0) return <EmptyState message="No users." />;
  return <ul className="userlist card">{users.map((u) => <UserRow key={u.uid} user={u} onSetAllowed={onSetAllowed} />)}</ul>;
}
