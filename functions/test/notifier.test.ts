import { describe, it, expect } from "vitest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { ulid } from "../src/ulid.js";
import { processScenarioEvent, processProjectStatusChange } from "../src/notify/notifier.js";

const P = "teams/t1/projects/web";
async function seedScenario(threshold = 80) {
  await db().doc(`${P}/scenarios/s1`).set({ goalId: "g1", title: "Login", threshold, rubric: { criteria: [] } });
}
async function addScore(composite: number) { await db().doc(`${P}/scores/${ulid()}`).set({ scenarioId: "s1", taskId: "t", composite }); }
async function addRun(failed: number) { await db().doc(`${P}/testRuns/${ulid()}`).set({ scenarioId: "s1", taskId: "t", passed: 1, failed }); }
async function notifs() { return (await db().collection(`teams/t1/notifications`).get()).docs.map((d) => d.data()); }

describe("processScenarioEvent", () => {
  it("writes scenario_met on first met + sets lastNotifiedState; no dup on re-run", async () => {
    await seedScenario(); await addScore(90); await addRun(0);
    await processScenarioEvent("t1", "web", "s1");
    let ns = await notifs();
    expect(ns.filter((n) => n.type === "scenario_met")).toHaveLength(1);
    expect((await db().doc(`${P}/scenarios/s1`).get()).data()!.lastNotifiedState).toBe("met");
    await processScenarioEvent("t1", "web", "s1"); // no change
    expect((await notifs()).filter((n) => n.type === "scenario_met")).toHaveLength(1);
  });
  it("writes scenario_unmet on regression and clears lastLoopCompleteNotified", async () => {
    await seedScenario(); await addScore(90); await addRun(0);
    await processScenarioEvent("t1", "web", "s1"); // met (also loop_complete since all met)
    await db().doc(P).set({ lastLoopCompleteNotified: true }, { merge: true });
    await addRun(2); // now failing
    await processScenarioEvent("t1", "web", "s1");
    expect((await notifs()).filter((n) => n.type === "scenario_unmet")).toHaveLength(1);
    expect((await db().doc(P).get()).data()!.lastLoopCompleteNotified).toBe(false);
  });
  it("emits a single loop_complete when all scenarios met", async () => {
    await seedScenario(); await addScore(90); await addRun(0);
    await processScenarioEvent("t1", "web", "s1");
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1);
    await processScenarioEvent("t1", "web", "s1");
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1); // deduped
  });
});

describe("processProjectStatusChange", () => {
  it("emits loop_complete on status →completed (edge only)", async () => {
    await db().doc(P).set({ slug: "web", title: "W", status: "running" });
    await processProjectStatusChange("t1", "web", "running", "completed");
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1);
    await processProjectStatusChange("t1", "web", "completed", "completed"); // no edge
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1);
  });
});
