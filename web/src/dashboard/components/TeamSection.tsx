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
      <div className="team-section-head">
        <h2 className="team-name">{team.name ?? teamId}</h2>
        {!loading && !error && (
          <span className="team-meta">
            <span className="dim">{projects.length} project{projects.length !== 1 ? "s" : ""}</span>
          </span>
        )}
      </div>
      {loading ? <Spinner />
        : error ? <ErrorNote message={error} />
        : projects.length === 0 ? <EmptyState message="No projects yet" />
        : <div className="pgrid">{projects.map((p) => <ProjectCard key={p.slug} teamId={teamId} project={p} />)}</div>}
    </section>
  );
}
