import { useState } from "react";
import { useAuth } from "../auth/context";
import { useMyTeams, useTeam } from "../dashboard/hooks";
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

function TeamSlug({ teamId }: { teamId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="team-slug"
      title="Team ID — use with `autoloop init --team`. Click to copy."
      onClick={() => { void navigator.clipboard?.writeText(teamId); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
    >
      <span className="team-slug-label dim">ID</span>
      <code className="team-slug-id">{teamId}</code>
      <span className="team-slug-copy dim">{copied ? "copied ✓" : "copy"}</span>
    </button>
  );
}

function TeamAdminContainer({ teamId, role }: { teamId: string; role: Role }) {
  const { uid } = useAuth().user!;
  const team = useTeam(teamId);
  const members = useTeamMembers(teamId);
  const invites = useTeamInvites(teamId);
  const { err, run } = useActionError();
  const isManager = role === "owner" || role === "admin";
  return (
    <section className="teamcard card">
      <div className="teamcard-head">
        <div className="teamcard-titles">
          <h3 className="teamcard-name serif">{team.data?.name ?? teamId}</h3>
          <TeamSlug teamId={teamId} />
        </div>
        <span className="team-meta">
          <span className={`role${role === "owner" ? " owner" : ""}`}>{role}</span>
        </span>
      </div>
      {err && <ErrorNote message={err} />}
      {members.loading ? <Spinner /> : members.error ? <ErrorNote message={members.error} />
        : <ul className="members">{members.data.map((m) => (
            <MemberRow key={m.uid} member={m} viewerRole={role} selfUid={uid}
              onChangeRole={(u, r) => run(actions.changeRole(teamId, u, r))}
              onRemove={(u) => run(actions.removeMember(teamId, u))} />
          ))}</ul>}
      {isManager && (
        <div className="teamcard-manage">
          <InviteForm onInvite={(email, r) => run(actions.inviteMember(teamId, email, r))} />
          {invites.loading ? <Spinner /> : invites.error ? <ErrorNote message={invites.error} />
            : invites.data.length === 0 ? null
            : <ul className="sent-invites">{invites.data.map((i) => (
                <InviteRow key={i.id} invite={i} onRevoke={(inv) => run(actions.revokeInvite(teamId, inv.id))} />
              ))}</ul>}
        </div>
      )}
    </section>
  );
}

export function TeamsPage() {
  const teams = useMyTeams();
  const pending = useMyPendingInvites();
  const { err, run } = useActionError();
  return (
    <div className="main main--narrow">
      <div className="page-head">
        <h1 className="page-title">Teams</h1>
        <p className="page-sub">Create teams, manage members, and handle invites.</p>
      </div>
      {err && <ErrorNote message={err} />}

      <section className="mblock">
        <h2 className="mblock-title">Create a team</h2>
        <TeamCreateForm onCreate={(name) => run(actions.createTeam(teamIdFromName(name), name))} />
      </section>

      <section className="mblock">
        <h2 className="mblock-title">Pending invites for you</h2>
        {pending.loading ? <Spinner /> : pending.error ? <ErrorNote message={pending.error} />
          : pending.data.length === 0 ? <EmptyState message="No pending invites" />
          : <ul className="invite-list">{pending.data.map((i) => (
              <PendingInviteRow key={i.id} invite={i}
                onAccept={(inv) => run(actions.acceptInvite(inv))}
                onDecline={(inv) => run(actions.declineInvite(inv))} />
            ))}</ul>}
      </section>

      <section className="mblock">
        <h2 className="mblock-title">Your teams</h2>
        {teams.loading ? <Spinner /> : teams.error ? <ErrorNote message={teams.error} />
          : teams.data.length === 0 ? <EmptyState message="You're not on a team yet." />
          : <div className="teamcards">{teams.data.map((t) => <TeamAdminContainer key={t.teamId} teamId={t.teamId} role={t.role as Role} />)}</div>}
      </section>
    </div>
  );
}
