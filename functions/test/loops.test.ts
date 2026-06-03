import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();
async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}
async function createProject(slug = "acme") {
  await seedTeam();
  await request(app).put(`/v1/teams/team1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}

describe("PUT /v1/teams/:teamId/projects/:slug/loops/:loopId", () => {
  it("404s when the project does not exist", async () => {
    await seedTeam();
    expect((await request(app).put("/v1/teams/team1/projects/ghost/loops/l1").set(authHeader()).send({ goal: "build search", order: 1, status: "running" })).status).toBe(404);
  });
  it("requires goal+order+status on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ name: "x" })).status).toBe(400);
  });
  it("creates a loop, stamps startedAt, sets project.currentLoopId", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ goal: "search", order: 1, status: "running" })).status).toBe(200);
    const loop = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(loop.goal).toBe("search");
    expect(loop.startedAt).toBeDefined();
    expect(loop.endedAt ?? null).toBeNull();
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentLoopId).toBe("l1");
  });
  it("advances currentLoopId when the current loop completes; null when all terminal", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ goal: "a", order: 1, status: "running" });
    await request(app).put("/v1/teams/team1/projects/acme/loops/l2").set(authHeader()).send({ goal: "b", order: 2, status: "queued" });
    await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentLoopId).toBe("l2");
    await request(app).put("/v1/teams/team1/projects/acme/loops/l2").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentLoopId ?? null).toBeNull();
  });
});

describe("loop-scoped routes (full HTTP path)", () => {
  const rubric = { criteria: [{ id: "correctness", name: "C", weight: 1, max: 5 }] };
  it("phase/task/commit/score land under loops/l1 with per-loop derived ids", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader()).send({ goalId: "g1", title: "S", rubric });
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ goal: "g", order: 1, status: "running" })).status).toBe(200);
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1/phases/p1").set(authHeader()).send({ name: "P", order: 1, status: "running" })).status).toBe(200);
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "T", order: 1, status: "running" })).status).toBe(200);
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1/tasks/t1/commits/abc").set(authHeader()).send({ message: "m", author: "a" })).status).toBe(200);
    const score = await request(app).post("/v1/teams/team1/projects/acme/loops/l1/scores").set(authHeader()).send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 4 }, composite: 80 });
    expect(score.status).toBe(200);

    expect((await db().doc("teams/team1/projects/acme/loops/l1/phases/p1").get()).exists).toBe(true);
    expect((await db().doc("teams/team1/projects/acme/loops/l1/tasks/t1").get()).exists).toBe(true);
    expect((await db().doc("teams/team1/projects/acme/loops/l1/tasks/t1/commits/abc").get()).exists).toBe(true);
    expect((await db().doc(`teams/team1/projects/acme/loops/l1/scores/${score.body.id}`).get()).exists).toBe(true);

    const loop = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(loop.currentPhaseId).toBe("p1");
    expect(loop.currentTaskId).toBe("t1");
    // visionOwner stamped on the project; project run-state derivation untouched
    const proj = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(proj.visionOwner).toBe("loop");
    expect(proj.currentPhaseId ?? null).toBeNull();
    expect(proj.currentTaskId ?? null).toBeNull();
  });
});
