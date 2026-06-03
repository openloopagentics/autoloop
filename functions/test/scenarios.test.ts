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

const rubric = { criteria: [{ id: "correctness", name: "Correctness", weight: 3, max: 5 }] };

describe("PUT /v1/teams/:teamId/projects/:slug/scenarios/:scenarioId", () => {
  it("requires goalId + title + rubric on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader()).send({ title: "S" })).status).toBe(400);
  });
  it("creates a scenario with a rubric, then patches the threshold", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader())
      .send({ goalId: "g1", title: "Login works", rubric, order: 1 })).status).toBe(200);
    let s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.rubric.criteria[0].id).toBe("correctness");
    expect((await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader()).send({ threshold: 90 })).status).toBe(200);
    s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.threshold).toBe(90);
    expect(s.title).toBe("Login works");
  });
});
