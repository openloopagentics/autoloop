import { useState } from "react";
import { useAuth } from "../auth/context";
import { useMyTeams } from "../dashboard/hooks";
import { Spinner } from "../dashboard/components/Spinner";
import { ErrorNote } from "../dashboard/components/ErrorNote";
import { EmptyState } from "../dashboard/components/EmptyState";
import { useTeamMembers, useTeamInvites, useMyPendingInvites } from "./hooks";
import * as actions from "./actions";
import { teamIdFromName } from "./teamId";
import { TeamCreateForm } from "./components/TeamCreateForm";
import { InviteForm } from "./components/InviteForm";
import { MemberRow } from "./components/MemberRow";
import { InviteRow } from "./components/InviteRow";
import { PendingInviteRow } from "./components/PendingInviteRow";
import type { Role } from "./types";

function useActionError() {
  const [err, setErr] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => p.catch((e) => setErr((e as Error).message));
  return { err, run };
}

function TeamAdminContainer({ teamId, role }: { teamId: string; role: Role }) {
  const { uid } = useAuth().user!;
  const members = useTeamMembers(teamId);
  const invites = useTeamInvites(teamId);
  const { err, run } = useActionError();
  const isManager = role === "owner" || role === "admin";
  return (
    <section>
      <h2>{teamId}</h2>
      {err && <ErrorNote message={err} />}
      {members.loading ? <Spinner /> : members.error ? <ErrorNote message={members.error} />
        : <ul>{members.data.map((m) => (
            <MemberRow key={m.uid} member={m} viewerRole={role} selfUid={uid}
              onChangeRole={(u, r) => run(actions.changeRole(teamId, u, r))}
              onRemove={(u) => run(actions.removeMember(teamId, u))} />
          ))}</ul>}
      {isManager && (
        <>
          <InviteForm onInvite={(email, r) => run(actions.inviteMember(teamId, email, r))} />
          {invites.loading ? <Spinner /> : invites.error ? <ErrorNote message={invites.error} />
            : invites.data.length === 0 ? <EmptyState message="No invites" />
            : <ul>{invites.data.map((i) => (
                <InviteRow key={i.id} invite={i} onRevoke={(inv) => run(actions.revokeInvite(teamId, inv.id))} />
              ))}</ul>}
        </>
      )}
    </section>
  );
}

export function TeamsPage() {
  const teams = useMyTeams();
  const pending = useMyPendingInvites();
  const { err, run } = useActionError();
  return (
    <div>
      <h1>Teams</h1>
      {err && <ErrorNote message={err} />}
      <TeamCreateForm onCreate={(name) => run(actions.createTeam(teamIdFromName(name), name))} />

      <h2>Pending invites for you</h2>
      {pending.loading ? <Spinner /> : pending.error ? <ErrorNote message={pending.error} />
        : pending.data.length === 0 ? <EmptyState message="No pending invites" />
        : <ul>{pending.data.map((i) => (
            <PendingInviteRow key={i.id} invite={i}
              onAccept={(inv) => run(actions.acceptInvite(inv))}
              onDecline={(inv) => run(actions.declineInvite(inv))} />
          ))}</ul>}

      <h2>Your teams</h2>
      {teams.loading ? <Spinner /> : teams.error ? <ErrorNote message={teams.error} />
        : teams.data.length === 0 ? <EmptyState message="You're not on a team yet." />
        : teams.data.map((t) => <TeamAdminContainer key={t.teamId} teamId={t.teamId} role={t.role as Role} />)}
    </div>
  );
}
