import { useEffect, useState } from "react";
import { listUsers, setAllowed } from "./client";
import { UserList } from "./components/UserList";
import { GrantByUidForm } from "./components/GrantByUidForm";
import { Spinner } from "../dashboard/components/Spinner";
import { ErrorNote } from "../dashboard/components/ErrorNote";
import type { AdminUser } from "./types";

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try { setUsers(await listUsers()); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const act = (p: Promise<unknown>) => p.then(refresh).catch((e) => setError((e as Error).message));

  return (
    <div>
      <h1>Admin — allowlist</h1>
      <h2>Grant access by UID</h2>
      <GrantByUidForm onGrant={(uid, email) => act(setAllowed(uid, true, email || undefined))} />
      {error && <ErrorNote message={error} />}
      {loading ? <Spinner /> : <UserList users={users} onSetAllowed={(uid, next) => act(setAllowed(uid, next))} />}
    </div>
  );
}
