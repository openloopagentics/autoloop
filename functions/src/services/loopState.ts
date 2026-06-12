import { resolveBase } from "./baseRef.js";
import { listPendingUserMessages, type MessagePreview } from "./messages.js";

type Ref = FirebaseFirestore.DocumentReference;
type DocSnap = FirebaseFirestore.QueryDocumentSnapshot;

export interface LoopState {
  loop: Record<string, unknown> | null;       // null project-direct
  project: Record<string, unknown>;
  phases: Array<Record<string, unknown>>;     // ordered by order
  tasks: Array<Record<string, unknown>>;      // ordered by order
  scenarios: Array<Record<string, unknown>>;  // project-level vision; latest events loop-scoped
  openBugs: Array<Record<string, unknown>>;
  pendingMessages: MessagePreview[];          // project-level, oldest-first
}

/** Copy only the defined keys (omitted fields stay omitted in the bundle). */
function pick(src: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Latest event for a scenario: order by document id (ULID — lexically time-sortable),
 *  NOT createdAt. Equality filter + __name__ order needs no composite index. */
async function latestEvent(baseRef: Ref, coll: "scores" | "testRuns", scenarioId: string) {
  const snap = await baseRef.collection(coll)
    .where("scenarioId", "==", scenarioId)
    .orderBy("__name__", "desc")
    .limit(1)
    .get();
  return snap.empty ? undefined : snap.docs[0].data();
}

/**
 * Aggregated resume bundle (Phase 1 of resumable loops). Pure read: parallel reads of the
 * base-path collections (loop-scoped via resolveBase, else project-direct), project-level
 * scenarios + pending messages (reusing the messages service), and per-scenario latest
 * score/testRun (N+1 limit-1 queries — scenario count is small; consistent with the
 * no-composite-indexes stance).
 */
export async function getLoopState(teamId: string, slug: string, loopId?: string): Promise<LoopState> {
  const { projectRef, baseRef } = await resolveBase(teamId, slug, loopId); // 404s project/loop
  const [loopSnap, projectSnap, phasesSnap, tasksSnap, scenariosSnap, bugsSnap, pendingMessages] = await Promise.all([
    loopId ? baseRef.get() : Promise.resolve(undefined),
    projectRef.get(),
    baseRef.collection("phases").orderBy("order").get(),
    baseRef.collection("tasks").orderBy("order").get(),
    // plain get: scenario `order` is optional and Firestore orderBy() DROPS docs missing the field
    projectRef.collection("scenarios").get(),
    baseRef.collection("bugs").where("status", "==", "open").get(),
    listPendingUserMessages(teamId, slug),
  ]);

  const project = { slug, ...pick(projectSnap.data()!, ["title", "status", "currentLoopId"]) };
  const loop = loopId && loopSnap?.exists
    ? { id: loopId, ...pick(loopSnap.data()!, ["goal", "name", "order", "status", "currentPhaseId", "currentTaskId"]) }
    : null;
  const phases = phasesSnap.docs.map((d) => ({ id: d.id, ...pick(d.data(), ["name", "order", "status"]) }));
  const tasks = tasksSnap.docs.map((d) => ({ id: d.id, scenarioIds: d.data().scenarioIds ?? [], ...pick(d.data(), ["phaseId", "title", "order", "status"]) }));
  const openBugs = bugsSnap.docs.map((d) => ({ id: d.id, ...pick(d.data(), ["title", "severity", "scenarioId", "taskId"]) }));

  const orderOf = (d: DocSnap) => (d.data().order as number | undefined) ?? Number.POSITIVE_INFINITY;
  const scenarioDocs = [...scenariosSnap.docs].sort((a, b) => orderOf(a) - orderOf(b) || a.id.localeCompare(b.id));
  const scenarios = await Promise.all(scenarioDocs.map(async (d) => {
    const [score, testRun] = await Promise.all([
      latestEvent(baseRef, "scores", d.id),
      latestEvent(baseRef, "testRuns", d.id),
    ]);
    const s: Record<string, unknown> = { id: d.id, ...pick(d.data(), ["goalId", "title", "threshold"]) };
    if (score) s.latestComposite = score.composite;
    if (testRun) s.latestTestRun = { passed: testRun.passed, failed: testRun.failed };
    return s;
  }));

  return { loop, project, phases, tasks, scenarios, openBugs, pendingMessages };
}
