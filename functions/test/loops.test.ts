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
