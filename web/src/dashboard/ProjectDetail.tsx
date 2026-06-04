import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  useProject, usePhases, useCommits, useGoals, useScenarios, useTasks,
  useScores, useTestRuns, useRevisions, useDocuments, useTaskCommits, useLoops, useBugs, useMessages,
} from "./hooks";
import { postMessage } from "./api";
import { buildLoopList, defaultSelectedLoop, loopArgFor } from "./loopView";
import { ProjectHeader } from "./components/ProjectHeader";
import { Tabs, type TabKey } from "./components/Tabs";
import { LoopSelector } from "./components/LoopSelector";
import { TaskItem } from "./components/TaskItem";
import { PhaseItem } from "./components/PhaseItem";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import { DashboardTab } from "./tabs/DashboardTab";
import { VisionTab } from "./tabs/VisionTab";
import { LoopsTab } from "./tabs/LoopsTab";
import { BugsTab } from "./tabs/BugsTab";
import { MessagesTab } from "./tabs/MessagesTab";
import type { Phase, Task } from "./types";

function LegacyPhase({ teamId, slug, phase, loopId }: { teamId: string; slug: string; phase: Phase; loopId?: string }) {
  const { data } = useCommits(teamId, slug, phase.id ?? "", loopId);
  return <PhaseItem phase={phase} commits={data} />;
}
function PlanTask({ teamId, slug, task, loopId, isCurrent }: { teamId: string; slug: string; task: Task; loopId?: string; isCurrent: boolean }) {
  const { data } = useTaskCommits(teamId, slug, task.id, loopId);
  return <TaskItem task={task} commits={data} isCurrent={isCurrent} />;
}

export function ProjectDetail() {
  const { teamId = "", slug = "" } = useParams();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [picked, setPicked] = useState<string>("");

  const project = useProject(teamId, slug);
  const loops = useLoops(teamId, slug);
  const goals = useGoals(teamId, slug);
  const scenarios = useScenarios(teamId, slug);
  const documents = useDocuments(teamId, slug);

  // Project-direct reads: detect legacy data for `main` synthesis.
  const directPhases = usePhases(teamId, slug);
  const directTasks = useTasks(teamId, slug);
  const hasProjectDirectData = directPhases.data.length > 0 || directTasks.data.length > 0;

  const loopList = buildLoopList(loops.data, project.data ?? null, hasProjectDirectData);
  const selectedId = (picked && loopList.some((l) => l.id === picked)) ? picked : defaultSelectedLoop(loopList, project.data?.currentLoopId);
  const selected = loopList.find((l) => l.id === selectedId);
  const loopArg = loopArgFor(selected);

  // Selected-loop run data (re-subscribes when loopArg changes).
  const phases = usePhases(teamId, slug, loopArg);
  const tasks = useTasks(teamId, slug, loopArg);
  const scores = useScores(teamId, slug, loopArg);
  const testRuns = useTestRuns(teamId, slug, loopArg);
  const revisions = useRevisions(teamId, slug, loopArg);
  const bugs = useBugs(teamId, slug, loopArg);
  const messages = useMessages(teamId, slug);

  const agentActive = loops.data.some((l) => l.status === "running") || (loops.data.length === 0 && project.data?.status === "running");
  const editable = Boolean(project.data) && project.data?.visionOwner !== "loop";
  const renderLegacyPhase = (p: Phase) => <LegacyPhase teamId={teamId} slug={slug} phase={p} loopId={loopArg} />;
  const renderTask = (t: Task, isCurrent: boolean) => <PlanTask teamId={teamId} slug={slug} task={t} loopId={loopArg} isCurrent={isCurrent} />;

  // Surface (don't swallow) load errors from any of the project's data sources.
  const dataError = loops.error || phases.error || tasks.error || scores.error || testRuns.error
    || revisions.error || bugs.error || goals.error || scenarios.error || documents.error || null;
  // Show a spinner only on a source's FIRST load (loading + still empty), so switching
  // loops — which keeps prior data until the new snapshot arrives — doesn't flash.
  const tabLoading =
    tab === "dashboard" ? (loops.loading && loops.data.length === 0) || (phases.loading && phases.data.length === 0)
    : tab === "loops" ? (phases.loading && phases.data.length === 0)
    : tab === "bugs" ? (bugs.loading && bugs.data.length === 0)
    : tab === "messages" ? (messages.loading && messages.data.length === 0)
    : (scenarios.loading && scenarios.data.length === 0); // vision

  return (
    <div className="main main--narrow">
      <Link to="/dashboard" className="back">← back to dashboard</Link>
      {project.loading ? <Spinner />
        : project.error ? <ErrorNote message={project.error} />
        : project.data === null ? <EmptyState message="Project not found." />
        : (
          <>
            {project.data && <ProjectHeader project={project.data} />}
            <Tabs active={tab} onChange={setTab} />
            {tab !== "vision" && tab !== "messages" && <LoopSelector loops={loopList} selectedId={selectedId} onChange={setPicked} />}
            {dataError && <ErrorNote message={dataError} />}

            {tabLoading ? <Spinner /> : (
              <>
                {tab === "dashboard" && (
                  <DashboardTab loops={loopList} selected={selected} status={project.data?.status}
                    phases={phases.data} tasks={tasks.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data} />
                )}
                {tab === "vision" && (
                  <VisionTab teamId={teamId} slug={slug} editable={editable}
                    goals={goals.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data} documents={documents.data} />
                )}
                {tab === "loops" && (
                  <LoopsTab teamId={teamId} slug={slug} loops={loopList} scenarios={scenarios.data}
                    selectedId={selectedId} selected={selected} onSelect={setPicked}
                    phases={phases.data} tasks={tasks.data} testRuns={testRuns.data} revisions={revisions.data}
                    renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />
                )}
                {tab === "bugs" && <BugsTab bugs={bugs.data} />}
                {tab === "messages" && <MessagesTab teamId={teamId} slug={slug} loopId={loopArg} messages={messages.data} onSend={(t) => postMessage(teamId, slug, t)} agentActive={agentActive} />}
              </>
            )}
          </>
        )}
    </div>
  );
}
