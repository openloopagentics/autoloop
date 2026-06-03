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

describe("PUT /v1/teams/:teamId/projects/:slug/goals/:goalId", () => {
  it("404s when the project does not exist", async () => {
    await seedTeam();
    const res = await request(app).put("/v1/teams/team1/projects/ghost/goals/g1").set(authHeader()).send({ title: "Ship" });
    expect(res.status).toBe(404);
  });
  it("requires title on create", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/goals/g1").set(authHeader()).send({ order: 1 });
    expect(res.status).toBe(400);
  });
  it("creates then patches a goal", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/goals/g1").set(authHeader()).send({ title: "Ship", order: 1 })).status).toBe(200);
    let g = (await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!;
    expect(g.title).toBe("Ship");
    expect(g.createdAt).toBeDefined();
    expect((await request(app).put("/v1/teams/team1/projects/acme/goals/g1").set(authHeader()).send({ description: "x" })).status).toBe(200);
    g = (await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!;
    expect(g.title).toBe("Ship"); // unchanged on patch
    expect(g.description).toBe("x");
  });
});
