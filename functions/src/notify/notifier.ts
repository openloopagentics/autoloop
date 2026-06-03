import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { ulid } from "../ulid.js";
import { decideScenarioNotification, allMet, type State } from "./decide.js";

async function writeNotification(teamId: string, n: { type: string; projectSlug: string; scenarioId?: string; title: string; message: string }) {
  await db().doc(`teams/${teamId}/notifications/${ulid()}`).set({ ...n, createdAt: FieldValue.serverTimestamp() });
}
async function colById(path: string) {
  return (await db().collection(path).get()).docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Array<{ id: string }>;
}

/** Recompute one scenario's state on a score/testRun write; emit flip notifications + maybe loop_complete. */
export async function processScenarioEvent(teamId: string, slug: string, scenarioId: string): Promise<void> {
  const base = `teams/${teamId}/projects/${slug}`;
  const scnSnap = await db().doc(`${base}/scenarios/${scenarioId}`).get();
  if (!scnSnap.exists) return;
  const scenario = { id: scenarioId, threshold: scnSnap.data()!.threshold as number | undefined };
  // NOTE: this read-modify-write of lastNotifiedState is retry-safe (a retry re-reads the
  // updated state and no-ops) but NOT concurrency-safe; per-scenario scores are written
  // serially today, so concurrent double-notify is not a concern. Wrap in a transaction
  // if concurrent scoring is ever introduced.
  const lastState = scnSnap.data()!.lastNotifiedState as State | undefined;
  const scores = await colById(`${base}/scores`) as Array<{ id: string; scenarioId?: string; composite?: number }>;
  const testRuns = await colById(`${base}/testRuns`) as Array<{ id: string; scenarioId?: string; failed?: number }>;
  const { newState, type } = decideScenarioNotification(scenario, scores, testRuns, lastState);

  if (newState !== lastState) {
    await db().doc(`${base}/scenarios/${scenarioId}`).set({ lastNotifiedState: newState }, { merge: true });
  }
  if (type === "scenario_unmet") {
    await db().doc(base).set({ lastLoopCompleteNotified: false }, { merge: true }); // re-arm
  }
  if (type) {
    const title = type === "scenario_met" ? "Scenario met" : "Scenario regressed";
    await writeNotification(teamId, { type, projectSlug: slug, scenarioId, title, message: `${scenarioId} is now ${newState}` });
  }
  // loop_complete: only consider when this write made things met
  if (newState === "met") {
    const scenarios = (await colById(`${base}/scenarios`)) as Array<{ id: string }>;
    const byScn = <T extends { scenarioId?: string }>(xs: T[]) => Object.fromEntries(scenarios.map((s) => [s.id, xs.filter((x) => x.scenarioId === s.id)]));
    if (allMet(scenarios, byScn(scores), byScn(testRuns))) {
      const projSnap = await db().doc(base).get();
      if (projSnap.data()?.lastLoopCompleteNotified !== true) {
        await db().doc(base).set({ lastLoopCompleteNotified: true }, { merge: true });
        await writeNotification(teamId, { type: "loop_complete", projectSlug: slug, title: "Loop complete", message: "All scenarios met" });
      }
    }
  }
}

/** On project status edge → completed, emit one loop_complete. */
export async function processProjectStatusChange(teamId: string, slug: string, before: string | undefined, after: string | undefined): Promise<void> {
  if (before === "completed" || after !== "completed") return; // edge guard
  const base = `teams/${teamId}/projects/${slug}`;
  const projSnap = await db().doc(base).get();
  if (projSnap.data()?.lastLoopCompleteNotified === true) return;
  await db().doc(base).set({ lastLoopCompleteNotified: true }, { merge: true });
  await writeNotification(teamId, { type: "loop_complete", projectSlug: slug, title: "Loop complete", message: "Project marked completed" });
}
