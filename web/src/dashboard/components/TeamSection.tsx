import { ProjectCard } from "./ProjectCard";
import { Spinner } from "./Spinner";
import { ErrorNote } from "./ErrorNote";
import { EmptyState } from "./EmptyState";
import type { Project, Team } from "../types";

export function TeamSection(props: {
  teamId?: string; team: Team; projects: Project[]; loading: boolean; error: string | null;
}) {
  const { teamId = "", team, projects, loading, error } = props;
  return (
    <section className="team-section">
      <h2>{team.name ?? teamId}</h2>
      {loading ? <Spinner />
        : error ? <ErrorNote message={error} />
        : projects.length === 0 ? <EmptyState message="No projects yet" />
        : projects.map((p) => <ProjectCard key={p.slug} teamId={teamId} project={p} />)}
    </section>
  );
}
