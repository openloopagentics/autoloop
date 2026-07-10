import { useCallback, useEffect, useState } from "react";
import { ProjectCard } from "./ProjectCard";
import { useLoops, useTeam, useTeamProjects } from "../hooks";
import { effectiveProjectStatus } from "../loopView";
import type { Project, TeamRef } from "../types";

export type ProjectFilter = "running" | "all";

/** Which projects the filter keeps, given the per-slug EFFECTIVE statuses (the same
 *  loop-derived value the card badge shows — never the stored project status, which is
 *  stale whenever a project has loops). A project whose loops haven't reported yet is
 *  NOT shown under "running": tiles must only ever appear as statuses settle, never
 *  flash in and then disappear (no stored-status guessing on reload). */
export function visibleProjects(
  projects: Project[], statuses: Record<string, string | undefined>, filter: ProjectFilter,
): Project[] {
  if (filter === "all") return projects;
  return projects.filter((p) => p.slug in statuses && statuses[p.slug] === "running");
}

/** Resolves a project's effective status from its loops, reports it up for filtering,
 *  and renders the card only when visible. Stays mounted while hidden so its loops
 *  listener keeps the reported status current. */
function ProjectCardContainer({ teamId, teamName, project, onDelete, show, onStatus }: {
  teamId: string; teamName?: string; project: Project; onDelete?: () => void;
  show: boolean; onStatus: (slug: string, status: string | undefined) => void;
}) {
  const loops = useLoops(teamId, project.slug);
  const status = effectiveProjectStatus(loops.data, project.status);
  // Report only once the loops snapshot has arrived — before that, `status` is just the
  // stored fallback (loops []) and reporting it would re-introduce the reload flash.
  useEffect(() => {
    if (!loops.loading) onStatus(project.slug, status);
  }, [project.slug, status, loops.loading, onStatus]);
  if (!show) return null;
  return <ProjectCard teamId={teamId} project={project} status={status} onDelete={onDelete} teamName={teamName} />;
}

/** One team's tiles for the single-grid dashboard: renders its visible project cards
 *  (team name as a label on each tile) directly into the surrounding grid, and reports
 *  {visible, total} counts up so DashboardHome can show one global hidden/empty note. */
export function TeamTiles({ teamRef, filter, onCounts, onDeleteProject }: {
  teamRef: TeamRef;
  filter: ProjectFilter;
  onCounts: (teamId: string, counts: { visible: number; total: number }) => void;
  onDeleteProject?: (slug: string) => void;
}) {
  const team = useTeam(teamRef.teamId);
  const projects = useTeamProjects(teamRef.teamId);
  const [statuses, setStatuses] = useState<Record<string, string | undefined>>({});
  const onStatus = useCallback((slug: string, s: string | undefined) => {
    setStatuses((prev) => (prev[slug] === s ? prev : { ...prev, [slug]: s }));
  }, []);
  const visible = visibleProjects(projects.data, statuses, filter);
  const visibleSlugs = new Set(visible.map((p) => p.slug));
  // Counts go up only once every project's loops have reported ("settled") — GridNote
  // must not announce hidden/empty totals while statuses are still arriving.
  const settled = projects.data.every((p) => p.slug in statuses);
  useEffect(() => {
    if (!projects.loading && settled) {
      onCounts(teamRef.teamId, { visible: visible.length, total: projects.data.length });
    }
  }, [teamRef.teamId, visible.length, projects.data.length, projects.loading, settled, onCounts]);
  const teamName = team.data?.name ?? teamRef.teamId;
  return (
    <>
      {projects.data.map((p) => (
        <ProjectCardContainer
          key={p.slug} teamId={teamRef.teamId} teamName={teamName} project={p}
          show={visibleSlugs.has(p.slug)} onStatus={onStatus}
          onDelete={onDeleteProject ? () => onDeleteProject(p.slug) : undefined}
        />
      ))}
    </>
  );
}
