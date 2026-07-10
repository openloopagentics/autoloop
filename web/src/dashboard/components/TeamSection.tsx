import { useCallback, useEffect, useState } from "react";
import { ProjectCard } from "./ProjectCard";
import { Spinner } from "./Spinner";
import { ErrorNote } from "./ErrorNote";
import { EmptyState } from "./EmptyState";
import { useLoops } from "../hooks";
import { effectiveProjectStatus } from "../loopView";
import type { Project, Team } from "../types";

/** Resolves each project's effective status from its loops (running only if a loop is),
 *  reports it up for filtering, and renders the card only when visible. It stays mounted
 *  while hidden so its loops listener keeps the reported status current. */
function ProjectCardContainer({ teamId, project, onDelete, show, onStatus }: {
  teamId: string; project: Project; onDelete?: () => void;
  show: boolean; onStatus: (slug: string, status: string | undefined) => void;
}) {
  const loops = useLoops(teamId, project.slug);
  const status = effectiveProjectStatus(loops.data, project.status);
  useEffect(() => { onStatus(project.slug, status); }, [project.slug, status, onStatus]);
  if (!show) return null;
  return <ProjectCard teamId={teamId} project={project} status={status} onDelete={onDelete} />;
}

export type ProjectFilter = "running" | "all";

/** Which projects the filter keeps, given the per-slug EFFECTIVE statuses (the same
 *  loop-derived value the card badge shows — never the stored project status, which is
 *  stale whenever a project has loops). Falls back to the stored status only while a
 *  project's loops haven't reported yet. */
export function visibleProjects(
  projects: Project[], statuses: Record<string, string | undefined>, filter: ProjectFilter,
): Project[] {
  if (filter === "all") return projects;
  return projects.filter((p) => (p.slug in statuses ? statuses[p.slug] : p.status) === "running");
}

export function TeamSection(props: {
  teamId?: string; team: Team; projects: Project[]; loading: boolean; error: string | null;
  onDeleteProject?: (slug: string) => void;
  filter?: ProjectFilter;
  onShowAll?: () => void;
}) {
  const { teamId = "", team, projects, loading, error, onDeleteProject, filter = "all", onShowAll } = props;
  // Effective statuses reported by the always-mounted card containers below.
  const [statuses, setStatuses] = useState<Record<string, string | undefined>>({});
  const onStatus = useCallback((slug: string, s: string | undefined) => {
    setStatuses((prev) => (prev[slug] === s ? prev : { ...prev, [slug]: s }));
  }, []);
  const visible = visibleProjects(projects, statuses, filter);
  const visibleSlugs = new Set(visible.map((p) => p.slug));
  const hidden = projects.length - visible.length;
  const showAll = onShowAll && (
    <button type="button" className="btn-link" onClick={onShowAll}>Show all</button>
  );
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
        : <>
            <div className="pgrid">{projects.map((p) => (
              <ProjectCardContainer
                key={p.slug} teamId={teamId} project={p}
                show={visibleSlugs.has(p.slug)} onStatus={onStatus}
                onDelete={onDeleteProject ? () => onDeleteProject(p.slug) : undefined}
              />
            ))}</div>
            {visible.length === 0 ? (
              <p className="team-filter-note dim">No running projects · {hidden} hidden {showAll}</p>
            ) : hidden > 0 ? (
              <p className="team-filter-note dim">{hidden} hidden {showAll}</p>
            ) : null}
          </>}
    </section>
  );
}
