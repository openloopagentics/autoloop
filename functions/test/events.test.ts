import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";
import { appendScore, appendTestRun, appendRevision } from "../src/services/events.js";
import { upsertLoop } from "../src/services/loops.js";

const app = makeApp();
async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}
async function createProject(slug = "acme") {
  await seedTeam();
  await request(app).put(`/v1/teams/team1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}

const rubric = { criteria: [{ id: "correctness", name: "C", weight: 3, max: 5 }, { id: "ux", name: "UX", weight: 1, max: 5 }] };
async function seedScenario() {
  await createProject();
  await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader()).send({ goalId: "g1", title: "S", rubric });
}

describe("POST /v1/teams/:teamId/projects/:slug/scores", () => {
  it("404s when the scenario does not exist", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "ghost", taskId: "t1", criteria: { correctness: 3 }, composite: 60 });
    expect(res.status).toBe(404);
  });
  it("rejects a criterion key not in the rubric", async () => {
    await seedScenario();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { bogus: 3 }, composite: 60 });
    expect(res.status).toBe(400);
  });
  it("rejects a criterion value over its max", async () => {
    await seedScenario();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 9 }, composite: 60 });
    expect(res.status).toBe(400);
  });
  it("appends a score with a server-stamped sortable id and returns it", async () => {
    await seedScenario();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 4, ux: 3 }, composite: 82, note: "ok" });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const d = (await db().doc(`teams/team1/projects/acme/scores/${res.body.id}`).get()).data()!;
    expect(d.composite).toBe(82);
    expect(d.by).toBe("ai"); // default
    expect(d.createdAt).toBeDefined();
  });
  it("orders appended scores by id (replay order)", async () => {
    await seedScenario();
    const ids: string[] = [];
    for (const c of [60, 70, 90]) {
      const r = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
        .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 3 }, composite: c });
      ids.push(r.body.id);
    }
    const snap = await db().collection("teams/team1/projects/acme/scores").orderBy("__name__").get();
    expect(snap.docs.map((d) => d.id)).toEqual(ids); // append order == id order
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/testRuns", () => {
  it("404s when the project does not exist", async () => {
    await seedTeam();
    const res = await request(app).post("/v1/teams/team1/projects/ghost/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0 });
    expect(res.status).toBe(404);
  });
  it("appends a testRun with issues", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 8, failed: 1, issues: ["flaky login"] });
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/testRuns/${res.body.id}`).get()).data()!;
    expect(d.passed).toBe(8);
    expect(d.failed).toBe(1);
    expect(d.issues).toEqual(["flaky login"]);
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/revisions", () => {
  it("appends a revision capturing trigger + changes", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/revisions").set(authHeader())
      .send({ trigger: { scenarioId: "s1", reason: "still failing" }, changes: [{ op: "add", taskId: "t9", title: "Harden" }, { op: "drop", taskId: "t3" }] });
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/revisions/${res.body.id}`).get()).data()!;
    expect(d.trigger.reason).toBe("still failing");
    expect(d.changes).toHaveLength(2);
    expect(d.changes[0].title).toBe("Harden"); // passthrough detail preserved
  });
});

describe("loop-scoped events", () => {
  it("appendScore writes under loops/l1 but validates against the PROJECT scenario", async () => {
    await seedScenario(); // scenario s1 seeded at project level
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    const id = await appendScore("team1", "acme", { scenarioId: "s1", taskId: "t1", criteria: { correctness: 4, ux: 3 }, composite: 82 }, "l1");
    const d = (await db().doc(`teams/team1/projects/acme/loops/l1/scores/${id}`).get()).data();
    expect(d).toBeDefined();
    expect(d!.composite).toBe(82);
    // not written at project level
    expect((await db().doc(`teams/team1/projects/acme/scores/${id}`).get()).exists).toBe(false);
  });
  it("appendScore loop-scoped still rejects an unknown criterion (validates project scenario)", async () => {
    await seedScenario();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    await expect(appendScore("team1", "acme", { scenarioId: "s1", taskId: "t1", criteria: { bogus: 1 }, composite: 60 }, "l1"))
      .rejects.toMatchObject({ httpStatus: 400 });
  });
  it("appendScore 404s when the loop does not exist", async () => {
    await seedScenario();
    await expect(appendScore("team1", "acme", { scenarioId: "s1", taskId: "t1", criteria: { correctness: 3 }, composite: 60 }, "ghost"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
  it("appendTestRun / appendRevision write under loops/l1", async () => {
    await createProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    const tr = await appendTestRun("team1", "acme", { scenarioId: "s1", taskId: "t1", passed: 1, failed: 0 }, "l1");
    expect((await db().doc(`teams/team1/projects/acme/loops/l1/testRuns/${tr}`).get()).exists).toBe(true);
    const rv = await appendRevision("team1", "acme", { trigger: { scenarioId: "s1", reason: "x" }, changes: [{ op: "drop", taskId: "t3" }] }, "l1");
    expect((await db().doc(`teams/team1/projects/acme/loops/l1/revisions/${rv}`).get()).exists).toBe(true);
  });
});
