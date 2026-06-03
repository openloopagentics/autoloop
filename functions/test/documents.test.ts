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

describe("PUT /v1/teams/:teamId/projects/:slug/documents/:docId", () => {
  it("requires kind+title+format+content on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/documents/d1").set(authHeader()).send({ kind: "vision" })).status).toBe(400);
  });
  it("creates a markdown document", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/documents/d1").set(authHeader())
      .send({ kind: "vision", title: "Vision", format: "markdown", content: "# Vision" })).status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/documents/d1").get()).data()!;
    expect(d.kind).toBe("vision");
    expect(d.content).toBe("# Vision");
  });
  it("rejects content over 100KB with a 400", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/documents/d1").set(authHeader())
      .send({ kind: "vision", title: "V", format: "markdown", content: "x".repeat(100 * 1024 + 1) });
    expect(res.status).toBe(400);
  });
});
