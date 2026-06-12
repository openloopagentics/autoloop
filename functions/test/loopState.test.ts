import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";
import { Timestamp } from "firebase-admin/firestore";
import { getLoopState } from "../src/services/loopState.js";
import { createMessage } from "../src/services/messages.js";

const app = makeApp();
const rubric = { criteria: [{ id: "correctness", name: "C", weight: 1, max: 5 }] };

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}
async function createProject(slug = "acme") {
  await seedTeam();
  await request(app).put(`/v1/teams/team1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}
const put = (path: string, body: Record<string, unknown>) =>
  request(app).put(`/v1/teams/team1/projects/acme${path}`).set(authHeader()).send(body);

/** Full fixture: loop l1 with 2 phases / 3 tasks (seeded out of order), 2 scenarios,
 *  1 open + 1 fixed bug, 1 pending message. */
async function seedLoopFixture() {
  await createProject();
  await put("/scenarios/s1", { goalId: "g1", title: "S1", threshold: 80, rubric, order: 1 });
  await put("/scenarios/s2", { goalId: "g1", title: "S2", rubric }); // no order, no threshold
  await put("/loops/l1", { goal: "ship it", name: "Loop 1", order: 1, status: "running" });
  await put("/loops/l1/phases/p2", { name: "Polish", order: 2, status: "queued" });
  await put("/loops/l1/phases/p1", { name: "Build", order: 1, status: "running" });
  await put("/loops/l1/tasks/t3", { phaseId: "p2", title: "T3", order: 1, status: "queued", scenarioIds: ["s2"] });
  await put("/loops/l1/tasks/t2", { phaseId: "p1", title: "T2", order: 2, status: "running", scenarioIds: ["s1"] });
  await put("/loops/l1/tasks/t1", { phaseId: "p1", title: "T1", order: 1, status: "completed", scenarioIds: ["s1"] });
  await put("/loops/l1/bugs/b1", { title: "Open bug", status: "open", severity: "high", scenarioId: "s1", taskId: "t1" });
  await put("/loops/l1/bugs/b2", { title: "Fixed bug", status: "fixed" });
  await createMessage("team1", "acme", "first msg", "user", "u1");
}

describe("getLoopState (service)", () => {
  it("returns the loop-scoped bundle: loop doc, ordered phases/tasks, project-level scenarios, open bugs, pending messages", async () => {
    await seedLoopFixture();
    const s = await getLoopState("team1", "acme", "l1");

    expect(s.loop).toMatchObject({ id: "l1", goal: "ship it", name: "Loop 1", order: 1, status: "running" });
    expect((s.loop as Record<string, unknown>).currentPhaseId).toBe("p1");
    expect((s.loop as Record<string, unknown>).currentTaskId).toBe("t2");
    expect(s.project).toMatchObject({ slug: "acme", title: "Acme", status: "running", currentLoopId: "l1" });

    expect(s.phases.map((p) => p.id)).toEqual(["p1", "p2"]);            // by order
    expect(s.tasks.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);       // by task order (1,1,2)
    expect(s.tasks[0]).toMatchObject({ phaseId: "p1", title: "T1", order: 1, status: "completed", scenarioIds: ["s1"] });

    expect(s.scenarios.map((x) => x.id)).toEqual(["s1", "s2"]);         // order asc, missing-order last
    expect(s.scenarios[0]).toMatchObject({ goalId: "g1", title: "S1", threshold: 80 });

    expect(s.openBugs.length).toBe(1);                                  // fixed bug filtered out
    expect(s.openBugs[0]).toMatchObject({ id: "b1", title: "Open bug", severity: "high", scenarioId: "s1", taskId: "t1" });

    expect(s.pendingMessages.length).toBe(1);
    expect(s.pendingMessages[0].text).toBe("first msg");
  });

  it("returns pendingMessages oldest-first", async () => {
    await createProject();
    await createMessage("team1", "acme", "older", "user", "u1");
    await createMessage("team1", "acme", "newer", "user", "u1");
    const s = await getLoopState("team1", "acme");
    expect(s.pendingMessages.map((m) => m.text)).toEqual(["older", "newer"]);
  });

  it("project-direct: loop is null and phases/tasks come from the project root", async () => {
    await createProject();
    await put("/phases/p1", { name: "Build", order: 1, status: "running" });
    await put("/tasks/t1", { phaseId: "p1", title: "T1", order: 1, status: "running" });
    const s = await getLoopState("team1", "acme");
    expect(s.loop).toBeNull();
    expect(s.phases.map((p) => p.id)).toEqual(["p1"]);
    expect(s.tasks.map((t) => t.id)).toEqual(["t1"]);
  });

  it("attaches latestComposite + latestTestRun per scenario from LOOP-scoped events only", async () => {
    await seedLoopFixture();
    // project-direct events must NOT leak into the loop-scoped bundle
    await db().doc("teams/team1/projects/acme/scores/01PROJDIRECT").set(
      { scenarioId: "s1", taskId: "t1", criteria: {}, composite: 11, createdAt: Timestamp.now() });
    await request(app).post("/v1/teams/team1/projects/acme/loops/l1/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 4 }, composite: 85 });
    await request(app).post("/v1/teams/team1/projects/acme/loops/l1/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 7, failed: 1 });

    const s = await getLoopState("team1", "acme", "l1");
    const s1 = s.scenarios.find((x) => x.id === "s1")!;
    expect(s1.latestComposite).toBe(85);
    expect(s1.latestTestRun).toEqual({ passed: 7, failed: 1 });
    const s2 = s.scenarios.find((x) => x.id === "s2")!;
    expect(s2.latestComposite).toBeUndefined();
    expect(s2.latestTestRun).toBeUndefined();
  });

  it("selects the latest event by ULID id, NOT by createdAt timestamp", async () => {
    await seedLoopFixture();
    const base = "teams/team1/projects/acme/loops/l1";
    // lexically LATER id carries an OLDER createdAt — id must win
    await db().doc(`${base}/scores/01AAAAAAAAAAAAAAAAAAAAAAAA`).set(
      { scenarioId: "s1", taskId: "t1", criteria: {}, composite: 50, createdAt: Timestamp.fromDate(new Date("2026-06-09T12:00:00Z")) });
    await db().doc(`${base}/scores/01BBBBBBBBBBBBBBBBBBBBBBBB`).set(
      { scenarioId: "s1", taskId: "t1", criteria: {}, composite: 90, createdAt: Timestamp.fromDate(new Date("2026-06-01T00:00:00Z")) });
    const s = await getLoopState("team1", "acme", "l1");
    expect(s.scenarios.find((x) => x.id === "s1")!.latestComposite).toBe(90);
  });

  it("404s on a missing project and a missing loop", async () => {
    await seedTeam();
    await expect(getLoopState("team1", "ghost")).rejects.toMatchObject({ httpStatus: 404 });
    await createProject();
    await expect(getLoopState("team1", "acme", "ghost")).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("GET state (API)", () => {
  it("loop-scoped: 200 { ok, state } with the loop populated", async () => {
    await seedLoopFixture();
    const res = await request(app).get("/v1/teams/team1/projects/acme/loops/l1/state").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state.loop).toMatchObject({ id: "l1", status: "running" });
    expect(res.body.state.phases.map((p: { id: string }) => p.id)).toEqual(["p1", "p2"]);
    expect(res.body.state.pendingMessages.length).toBe(1);
  });

  it("project-direct: 200 with state.loop null and project.currentLoopId passthrough", async () => {
    await seedLoopFixture(); // loop exists, but we hit the project-direct route
    const res = await request(app).get("/v1/teams/team1/projects/acme/state").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.state.loop).toBeNull();
    expect(res.body.state.project.currentLoopId).toBe("l1");
  });

  it("401s without an API key", async () => {
    await seedLoopFixture();
    expect((await request(app).get("/v1/teams/team1/projects/acme/loops/l1/state")).status).toBe(401);
    expect((await request(app).get("/v1/teams/team1/projects/acme/state")).status).toBe(401);
  });

  it("404s on a missing loop and a missing project", async () => {
    await createProject();
    expect((await request(app).get("/v1/teams/team1/projects/acme/loops/ghost/state").set(authHeader())).status).toBe(404);
    expect((await request(app).get("/v1/teams/team1/projects/ghost/state").set(authHeader())).status).toBe(404);
  });
});
