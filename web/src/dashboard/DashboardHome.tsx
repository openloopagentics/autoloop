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
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (teams.length === 0) return <EmptyState message="You're not on a team yet." />;
  return <>{teams.map((t) => <TeamSectionContainer key={t.teamId} teamRef={t} />)}</>;
}
