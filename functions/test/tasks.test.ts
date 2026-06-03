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

async function startPhase(phaseId: string, order: number, status = "running") {
  await request(app).put(`/v1/teams/team1/projects/acme/phases/${phaseId}`).set(authHeader()).send({ name: phaseId, order, status });
}

describe("PUT /v1/teams/:teamId/projects/:slug/tasks/:taskId", () => {
  it("requires phaseId+title+order+status on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ title: "T" })).status).toBe(400);
  });
  it("sets currentTaskId to the lowest-order non-terminal task in the current phase", async () => {
    await createProject();
    await startPhase("p1", 1);
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t2").set(authHeader()).send({ phaseId: "p1", title: "B", order: 2, status: "queued" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentTaskId).toBe("t1");
  });
  it("advances currentTaskId when the current task completes", async () => {
    await createProject();
    await startPhase("p1", 1);
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t2").set(authHeader()).send({ phaseId: "p1", title: "B", order: 2, status: "queued" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentTaskId).toBe("t2");
  });
  it("stores scenarioIds", async () => {
    await createProject();
    await startPhase("p1", 1);
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running", scenarioIds: ["s1", "s2"] });
    expect((await db().doc("teams/team1/projects/acme/tasks/t1").get()).data()!.scenarioIds).toEqual(["s1", "s2"]);
  });
  it("stamps visionOwner 'loop' on the project when an agent upserts a task", async () => {
    await createProject();
    await startPhase("p1", 1);
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running" });
    const proj = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(proj.visionOwner).toBe("loop");
  });
});
