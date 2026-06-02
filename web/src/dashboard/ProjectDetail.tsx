import { useParams } from "react-router-dom";
import { useProject, usePhases, useCommits } from "./hooks";
import { ProjectHeader } from "./components/ProjectHeader";
import { PhaseItem } from "./components/PhaseItem";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import type { Phase } from "./types";

function PhaseItemContainer({ teamId, slug, phase }: { teamId: string; slug: string; phase: Phase & { id?: string } }) {
  const { data: commits } = useCommits(teamId, slug, phase.id ?? "");
  return <PhaseItem phase={phase} commits={commits} />;
}

export function ProjectDetail() {
  const { teamId = "", slug = "" } = useParams();
  const project = useProject(teamId, slug);
  const phases = usePhases(teamId, slug);
  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorNote message={project.error} />;
  if (project.data === null) return <EmptyState message="Project not found." />;
  return (
    <div>
      {project.data && <ProjectHeader project={project.data} />}
      {phases.loading ? <Spinner />
        : phases.error ? <ErrorNote message={phases.error} />
        : phases.data.length === 0 ? <EmptyState message="No phases yet." />
        : phases.data.map((p) => <PhaseItemContainer key={(p as { id?: string }).id} teamId={teamId} slug={slug} phase={p} />)}
    </div>
  );
}
