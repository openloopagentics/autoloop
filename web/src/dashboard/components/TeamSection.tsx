import { ProjectCard } from "./ProjectCard";
import { Spinner } from "./Spinner";
import { ErrorNote } from "./ErrorNote";
import { EmptyState } from "./EmptyState";
import { useLoops } from "../hooks";
import { effectiveProjectStatus } from "../loopView";
import type { Project, Team } from "../types";

/** Resolves each project's effective status from its loops (running only if a loop is). */
function ProjectCardContainer({ teamId, project, onDelete }: {
  teamId: string; project: Project; onDelete?: () => void;
}) {
  const loops = useLoops(teamId, project.slug);
  const status = effectiveProjectStatus(loops.data, project.status);
  return <ProjectCard teamId={teamId} project={project} status={status} onDelete={onDelete} />;
}

export function TeamSection(props: {
  teamId?: string; team: Team; projects: Project[]; loading: boolean; error: string | null;
  onDeleteProject?: (slug: string) => void;
}) {
  const { teamId = "", team, projects, loading, error, onDeleteProject } = props;
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
        : <div className="pgrid">{projects.map((p) => (
            <ProjectCardContainer
              key={p.slug} teamId={teamId} project={p}
              onDelete={onDeleteProject ? () => onDeleteProject(p.slug) : undefined}
            />
          ))}</div>}
    </section>
  );
}
