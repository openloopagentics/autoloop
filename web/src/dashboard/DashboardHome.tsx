import { useMyTeams, useTeam, useTeamProjects } from "./hooks";
import { TeamSection } from "./components/TeamSection";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import type { TeamRef } from "./types";

function TeamSectionContainer({ teamRef }: { teamRef: TeamRef }) {
  const team = useTeam(teamRef.teamId);
  const projects = useTeamProjects(teamRef.teamId);
  return (
    <TeamSection
      teamId={teamRef.teamId}
      team={team.data ?? {}}
      projects={projects.data}
      loading={team.loading || projects.loading}
      error={team.error ?? projects.error}
    />
  );
}

export function DashboardHome() {
  const { data: teams, loading, error } = useMyTeams();
  return (
    <div className="main">
      <div className="page-head dash-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Live status, streaming from your agents.</p>
        </div>
        <span className="live-pill"><span className="sdot s-running is-live" /> live</span>
      </div>

      {loading ? <Spinner />
        : error ? <ErrorNote message={error} />
        : teams.length === 0 ? <EmptyState message="You're not on a team yet." />
        : teams.map((t) => <TeamSectionContainer key={t.teamId} teamRef={t} />)}
    </div>
  );
}
