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

async function setup() {
  await createProject();
  await request(app).put("/v1/teams/team1/projects/acme/phases/p1").set(authHeader()).send({ name: "P", order: 1, status: "running" });
  await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "T", order: 1, status: "running" });
}

describe("PUT /v1/teams/:teamId/projects/:slug/tasks/:taskId/commits/:sha", () => {
  it("404s when the task does not exist", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/tasks/ghost/commits/abc").set(authHeader()).send({ message: "m", author: "a" });
    expect(res.status).toBe(404);
  });
  it("requires message and author", async () => {
    await setup();
    expect((await request(app).put("/v1/teams/team1/projects/acme/tasks/t1/commits/abc").set(authHeader()).send({ message: "m" })).status).toBe(400);
  });
  it("writes a commit under the task", async () => {
    await setup();
    expect((await request(app).put("/v1/teams/team1/projects/acme/tasks/t1/commits/abc").set(authHeader())
      .send({ message: "feat: x", author: "Agent", committedAt: "2026-06-02T10:00:00Z" })).status).toBe(200);
    const c = (await db().doc("teams/team1/projects/acme/tasks/t1/commits/abc").get()).data()!;
    expect(c.message).toBe("feat: x");
    expect(c.author).toBe("Agent");
    expect(c.committedAt).toBeDefined();
  });
});
