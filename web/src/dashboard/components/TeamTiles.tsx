import { useCallback, useEffect, useState } from "react";
import { ProjectCard } from "./ProjectCard";
import { useLoops, useTeam, useTeamProjects } from "../hooks";
import { effectiveProjectStatus } from "../loopView";
import type { Project, TeamRef } from "../types";

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

/** Resolves a project's effective status from its loops, reports it up for filtering,
 *  and renders the card only when visible. Stays mounted while hidden so its loops
 *  listener keeps the reported status current. */
function ProjectCardContainer({ teamId, teamName, project, onDelete, show, onStatus }: {
  teamId: string; teamName?: string; project: Project; onDelete?: () => void;
  show: boolean; onStatus: (slug: string, status: string | undefined) => void;
}) {
  const loops = useLoops(teamId, project.slug);
  const status = effectiveProjectStatus(loops.data, project.status);
  useEffect(() => { onStatus(project.slug, status); }, [project.slug, status, onStatus]);
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
  useEffect(() => {
    if (!projects.loading) onCounts(teamRef.teamId, { visible: visible.length, total: projects.data.length });
  }, [teamRef.teamId, visible.length, projects.data.length, projects.loading, onCounts]);
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
