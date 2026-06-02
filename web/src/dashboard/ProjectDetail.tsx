import { useParams, Link } from "react-router-dom";
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

  return (
    <div className="main main--narrow">
      <Link to="/dashboard" className="back">← back to dashboard</Link>

      {project.loading ? <Spinner />
        : project.error ? <ErrorNote message={project.error} />
        : project.data === null ? <EmptyState message="Project not found." />
        : (
          <>
            {project.data && <ProjectHeader project={project.data} />}
            <div className="proj-section-head">
              <h2 className="proj-section-title">Phases</h2>
            </div>
            {phases.loading ? <Spinner />
              : phases.error ? <ErrorNote message={phases.error} />
              : phases.data.length === 0 ? <EmptyState message="No phases yet." />
              : <div className="phaselist">{phases.data.map((p) => <PhaseItemContainer key={(p as { id?: string }).id} teamId={teamId} slug={slug} phase={p} />)}</div>}
          </>
        )}
    </div>
  );
}
