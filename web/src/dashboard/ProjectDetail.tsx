import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  useProject, usePhases, useCommits, useGoals, useScenarios, useTasks,
  useScores, useTestRuns, useRevisions, useDocuments, useTaskCommits, useLoops, useBugs, useAllBugs, useAllScores, useAllTestRuns, useMessages, useVerifications, useIdeas, useVisionChanges, usePages, useComments, useMyTeams,
} from "./hooks";
import { auth } from "../firebase";
import { postMessage, putUserIdea, wakeProject } from "./api";
import { buildLoopList, defaultSelectedLoop, loopArgFor, loopIsRunning, effectiveProjectStatus } from "./loopView";
import { useLoopTrend } from "./useLoopTrend";
import { buildTrend } from "./trendView";
import { ProjectHeader } from "./components/ProjectHeader";
import { Tabs, isTabKey, wikiWideLayout, type TabKey } from "./components/Tabs";
import { TaskItem } from "./components/TaskItem";
import { PhaseItem } from "./components/PhaseItem";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import { DashboardTab } from "./tabs/DashboardTab";
import { VisionTab } from "./tabs/VisionTab";
import { LoopsTab } from "./tabs/LoopsTab";
import { TestsTab } from "./tabs/TestsTab";
import { BugsTab } from "./tabs/BugsTab";
import { MapTab } from "./tabs/MapTab";
import { IdeasTab } from "./tabs/IdeasTab";
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
  const { teamId = "", slug = "", tab: tabParam } = useParams();
  const navigate = useNavigate();
  const tab: TabKey = isTabKey(tabParam) ? tabParam : "dashboard";
  const setTab = (k: TabKey) => navigate(`/dashboard/${teamId}/${slug}/${k}`);
  const [picked, setPicked] = useState<string>("");

  const project = useProject(teamId, slug);
  const loops = useLoops(teamId, slug);
  const goals = useGoals(teamId, slug);
  const scenarios = useScenarios(teamId, slug);
  const documents = useDocuments(teamId, slug);
  const pages = usePages(teamId, slug);
  const comments = useComments(teamId, slug);
  const teams = useMyTeams();

  // Project-direct reads: detect legacy data for `main` synthesis.
  const directPhases = usePhases(teamId, slug);
  const directTasks = useTasks(teamId, slug);
  const hasProjectDirectData = directPhases.data.length > 0 || directTasks.data.length > 0;

  const loopList = buildLoopList(loops.data, project.data ?? null, hasProjectDirectData);
  // Project shows "running" only when a loop actually is; otherwise it reflects the latest loop.
  const projStatus = effectiveProjectStatus(loops.data, project.data?.status);
  const selectedId = (picked && loopList.some((l) => l.id === picked)) ? picked : defaultSelectedLoop(loopList, project.data?.currentLoopId);
  const selected = loopList.find((l) => l.id === selectedId);
  const loopArg = loopArgFor(selected);

  // Selected-loop run data (re-subscribes when loopArg changes).
  const phases = usePhases(teamId, slug, loopArg);
  const tasks = useTasks(teamId, slug, loopArg);
  const scores = useScores(teamId, slug, loopArg);
  const testRuns = useTestRuns(teamId, slug, loopArg);
  const revisions = useRevisions(teamId, slug, loopArg);
  const verifications = useVerifications(teamId, slug, loopArg); // selected-loop scope — Vision badges follow the loop selection (test-runs there are cross-loop); documented limitation
  const bugs = useAllBugs(teamId, slug); // all bugs across every loop — not loop-scoped
  const loopBugs = useBugs(teamId, slug, loopArg); // Map tab: bugs scoped to the selected loop
  const allScores = useAllScores(teamId, slug);     // scenarios are project-level → met-state spans all loops
  const allTestRuns = useAllTestRuns(teamId, slug); // all test runs across every loop
  const messages = useMessages(teamId, slug);
  const ideas = useIdeas(teamId, slug);
  const visionChanges = useVisionChanges(teamId, slug);

  const trend = useLoopTrend(teamId, slug, hasProjectDirectData);
  // Empty until every slice arrives — TrendsStrip hides itself below 2 points,
  // so partial fan-out data never renders a misleading half-trend.
  const trendPoints = trend.loading ? [] : buildTrend(trend.data, scenarios.data);

  // loopIsRunning applies the zombie rule — a loop stuck "running" but untouched for 3+ hours
  // does not claim an agent is listening.
  const agentActive = loops.data.some(loopIsRunning) || (loops.data.length === 0 && project.data?.status === "running");
  const editable = Boolean(project.data) && project.data?.visionOwner !== "loop";
  const currentUid = auth.currentUser?.uid;
  // Owner/admin on THIS team may accept any comment (backend enforces; UI mirrors).
  const myRole = teams.data.find((t) => t.teamId === teamId)?.role;
  const isAdmin = myRole === "owner" || myRole === "admin";
  const renderLegacyPhase = (p: Phase) => <LegacyPhase teamId={teamId} slug={slug} phase={p} loopId={loopArg} />;
  const renderTask = (t: Task, isCurrent: boolean) => <PlanTask teamId={teamId} slug={slug} task={t} loopId={loopArg} isCurrent={isCurrent} />;

  // Surface (don't swallow) load errors from any of the project's data sources.
  const dataError = loops.error || phases.error || tasks.error || scores.error || testRuns.error
    || revisions.error || verifications.error || bugs.error || loopBugs.error || allTestRuns.error || goals.error || scenarios.error || documents.error || ideas.error || trend.error || pages.error || comments.error || null;
  // Show a spinner only on a source's FIRST load (loading + still empty), so switching
  // loops — which keeps prior data until the new snapshot arrives — doesn't flash.
  const tabLoading =
    tab === "dashboard" ? (loops.loading && loops.data.length === 0) || (phases.loading && phases.data.length === 0)
    : tab === "loops" ? (phases.loading && phases.data.length === 0)
    : tab === "tests" ? (scenarios.loading && scenarios.data.length === 0) && (allTestRuns.loading && allTestRuns.data.length === 0)
    : tab === "bugs" ? (bugs.loading && bugs.data.length === 0)
    : tab === "ideas" ? (ideas.loading && ideas.data.length === 0)
    : tab === "messages" ? (messages.loading && messages.data.length === 0)
    : tab === "map" ? (goals.loading && goals.data.length === 0)
    : (scenarios.loading && scenarios.data.length === 0) || (pages.loading && pages.data.length === 0); // vision (pages gate the wiki)

  const wideLayout = wikiWideLayout(tab, pages.data.length > 0);

  return (
    <div className={`main${wideLayout ? "" : " main--narrow"}`}>
      <Link to="/dashboard" className="back">← back to dashboard</Link>
      {project.loading ? <Spinner />
        : project.error ? <ErrorNote message={project.error} />
        : project.data === null ? <EmptyState message="Project not found." />
        : (
          <>
            {project.data && (
              <ProjectHeader project={project.data} status={projStatus}
                onRestart={() => wakeProject(teamId, slug)} />
            )}
            <Tabs active={tab} onChange={setTab} />
            {dataError && <ErrorNote message={dataError} />}

            {tabLoading ? <Spinner /> : (
              <>
                {tab === "dashboard" && (
                  <DashboardTab loops={loopList} selected={selected} status={projStatus}
                    phases={phases.data} tasks={tasks.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data}
                    verifications={verifications.data} trendPoints={trendPoints} />
                )}
                {tab === "vision" && (
                  <VisionTab teamId={teamId} slug={slug} editable={editable}
                    goals={goals.data} scenarios={scenarios.data} scores={allScores.data} testRuns={allTestRuns.data} documents={documents.data}
                    verifications={verifications.data} pages={pages.data} comments={comments.data}
                    currentUid={currentUid} isAdmin={isAdmin} />
                )}
                {tab === "loops" && (
                  <LoopsTab teamId={teamId} slug={slug} loops={loopList} scenarios={scenarios.data}
                    selectedId={selectedId} selected={selected} onSelect={setPicked}
                    phases={phases.data} tasks={tasks.data} testRuns={testRuns.data} revisions={revisions.data} verifications={verifications.data}
                    renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />
                )}
                {tab === "tests" && <TestsTab scenarios={scenarios.data} testRuns={allTestRuns.data} />}
                {tab === "bugs" && <BugsTab bugs={bugs.data} />}
                {tab === "map" && (
                  <MapTab teamId={teamId} slug={slug} loops={loopList} selectedId={selectedId} loopArg={loopArg} onSelect={setPicked}
                    goals={goals.data} scenarios={scenarios.data} scores={allScores.data} testRuns={allTestRuns.data}
                    tasks={tasks.data} bugs={loopBugs.data} currentTaskId={selected?.currentTaskId}
                    verifications={verifications.data} revisions={revisions.data} visionChanges={visionChanges.data}
                    ideas={ideas.data} projectCreatedAt={project.data?.createdAt} />
                )}
                {tab === "ideas" && <IdeasTab ideas={ideas.data} onPut={(id, body) => putUserIdea(teamId, slug, id, body)} />}
                {tab === "messages" && <MessagesTab teamId={teamId} slug={slug} messages={messages.data} onSend={(t) => postMessage(teamId, slug, t)} agentActive={agentActive} />}
              </>
            )}
          </>
        )}
    </div>
  );
}
