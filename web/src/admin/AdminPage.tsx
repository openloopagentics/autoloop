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
    <div className="main main--narrow">
      <div className="page-head">
        <h1 className="page-title">Admin</h1>
        <p className="page-sub">Manage the global access allowlist.</p>
      </div>

      <section className="mblock">
        <h2 className="mblock-title">Grant access by UID</h2>
        <p className="mblock-hint">For people who haven't signed in yet — use the User ID from their Request Access screen.</p>
        <GrantByUidForm onGrant={(uid, email) => act(setAllowed(uid, true, email || undefined))} />
      </section>

      {error && <ErrorNote message={error} />}

      <section className="mblock">
        <h2 className="mblock-title">All users</h2>
        {loading ? <Spinner /> : <UserList users={users} onSetAllowed={(uid, next) => act(setAllowed(uid, next))} />}
      </section>
    </div>
  );
}
