import { useParams, Link } from "react-router-dom";
import {
  useProject, usePhases, useCommits, useGoals, useScenarios, useTasks,
  useScores, useTestRuns, useRevisions, useDocuments, useTaskCommits,
} from "./hooks";
import { ProjectHeader } from "./components/ProjectHeader";
import { ScenariosMetBanner } from "./components/ScenariosMetBanner";
import { VisionSection } from "./components/VisionSection";
import { VisionEditableSection } from "./VisionEditableSection";
import { PlanSection } from "./components/PlanSection";
import { TaskItem } from "./components/TaskItem";
import { PhaseItem } from "./components/PhaseItem";
import { RevisionTimeline } from "./components/RevisionTimeline";
import { DocumentsSection } from "./components/DocumentsSection";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import { summarize } from "./scenarioState";
import type { Phase, Task } from "./types";

// Small containers so commit hooks are called at component top-level (not in a callback).
function LegacyPhase({ teamId, slug, phase }: { teamId: string; slug: string; phase: Phase }) {
  const { data } = useCommits(teamId, slug, phase.id ?? "");
  return <PhaseItem phase={phase} commits={data} />;
}
function PlanTask({ teamId, slug, task, isCurrent }: { teamId: string; slug: string; task: Task; isCurrent: boolean }) {
  const { data } = useTaskCommits(teamId, slug, task.id);
  return <TaskItem task={task} commits={data} isCurrent={isCurrent} />;
}

export function ProjectDetail() {
  const { teamId = "", slug = "" } = useParams();
  const project = useProject(teamId, slug);
  const phases = usePhases(teamId, slug);
  const goals = useGoals(teamId, slug);
  const scenarios = useScenarios(teamId, slug);
  const tasks = useTasks(teamId, slug);
  const scores = useScores(teamId, slug);
  const testRuns = useTestRuns(teamId, slug);
  const revisions = useRevisions(teamId, slug);
  const documents = useDocuments(teamId, slug);

  const hasScenarios = scenarios.data.length > 0;
  const editable = Boolean(project.data) && project.data?.visionOwner !== "loop";
  const { met, total } = summarize(scenarios.data, scores.data, testRuns.data);

  return (
    <div className="main main--narrow">
      <Link to="/dashboard" className="back">← back to dashboard</Link>
      {project.loading ? <Spinner />
        : project.error ? <ErrorNote message={project.error} />
        : project.data === null ? <EmptyState message="Project not found." />
        : (
          <>
            {project.data && <ProjectHeader project={project.data} />}
            {hasScenarios && <ScenariosMetBanner met={met} total={total} />}
            {editable
              ? <VisionEditableSection teamId={teamId} slug={slug} goals={goals.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data} documents={documents.data} />
              : hasScenarios && <VisionSection goals={goals.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data} />}

            {(phases.loading || tasks.loading) ? <Spinner />
              : (phases.error || tasks.error) ? <ErrorNote message={phases.error || tasks.error || ""} />
              : (
                <PlanSection
                  phases={phases.data}
                  tasks={tasks.data}
                  renderLegacyPhase={(p) => <LegacyPhase teamId={teamId} slug={slug} phase={p} />}
                  renderTask={(t, isCurrent) => <PlanTask teamId={teamId} slug={slug} task={t} isCurrent={isCurrent} />}
                />
              )}

            <RevisionTimeline revisions={revisions.data} />
            <DocumentsSection documents={documents.data} />
          </>
        )}
    </div>
  );
}
