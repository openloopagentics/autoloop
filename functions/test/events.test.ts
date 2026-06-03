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
