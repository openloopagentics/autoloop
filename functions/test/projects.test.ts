import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember, TEST_KEY } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId); // TEST_UID becomes a member so the test key can write
}

describe("PUT /v1/teams/:teamId/projects/:slug", () => {
  it("rejects unauthenticated writes", async () => {
    const res = await request(app).put("/v1/teams/team1/projects/acme").send({ title: "X", status: "queued" });
    expect(res.status).toBe(401);
  });

  it("accepts the x-api-key header as a fallback to Authorization", async () => {
    await seedTeam();
    const res = await request(app)
      .put("/v1/teams/team1/projects/acme")
      .set("x-api-key", TEST_KEY)
      .send({ title: "Acme", status: "queued" });
    expect(res.status).toBe(200);
  });

  it("returns a 404 error envelope for an unknown route", async () => {
    const res = await request(app).get("/v1/nope").set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("creates a project and stamps timestamps", async () => {
    await seedTeam();
    const res = await request(app)
      .put("/v1/teams/team1/projects/acme")
      .set(authHeader())
      .send({ title: "Acme", status: "queued" });
    expect(res.status).toBe(200);

    const doc = await db().doc("teams/team1/projects/acme").get();
    expect(doc.exists).toBe(true);
    expect(doc.data()!.title).toBe("Acme");
    expect(doc.data()!.createdAt).toBeDefined();
    expect(doc.data()!.updatedAt).toBeDefined();
    expect(doc.data()!.currentPhaseId ?? null).toBeNull();
  });

  it("requires title and status on create", async () => {
    await seedTeam();
    const res = await request(app).put("/v1/teams/team1/projects/acme").set(authHeader()).send({ title: "Acme" });
    expect(res.status).toBe(400);
  });

  it("merges on update and does not overwrite createdAt", async () => {
    await seedTeam();
    await request(app).put("/v1/teams/team1/projects/acme").set(authHeader()).send({ title: "Acme", status: "queued" });
    const first = (await db().doc("teams/team1/projects/acme").get()).data()!.createdAt;

    const res = await request(app).put("/v1/teams/team1/projects/acme").set(authHeader()).send({ status: "running" });
    expect(res.status).toBe(200);
    const doc = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(doc.status).toBe("running");
    expect(doc.title).toBe("Acme"); // unchanged
    expect(doc.createdAt.toMillis()).toBe(first.toMillis()); // not overwritten
  });

  it("ignores client-supplied server-owned fields", async () => {
    await seedTeam();
    await request(app)
      .put("/v1/teams/team1/projects/acme")
      .set(authHeader())
      .send({ title: "Acme", status: "queued", currentPhaseId: "hacked" });
    const doc = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(doc.currentPhaseId ?? null).toBeNull();
  });

  it("rejects an invalid slug", async () => {
    await seedTeam();
    const res = await request(app).put("/v1/teams/team1/projects/Bad%20Slug").set(authHeader()).send({ title: "x", status: "queued" });
    expect(res.status).toBe(400);
  });

  it("stores a design and server-stamps its updatedAt", async () => {
    await seedTeam();
    const res = await request(app)
      .put("/v1/teams/team1/projects/acme")
      .set(authHeader())
      .send({ title: "Acme", status: "queued", design: { format: "markdown", content: "# Plan" } });
    expect(res.status).toBe(200);
    const doc = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(doc.design.format).toBe("markdown");
    expect(doc.design.content).toBe("# Plan");
    expect(doc.design.updatedAt).toBeDefined();
  });

  it("403s when not a member of the team", async () => {
    const res = await request(app).put("/v1/teams/ghostteam/projects/acme")
      .set(authHeader()).send({ title: "Acme", status: "queued" });
    expect(res.status).toBe(403);
  });

  it("403 for a team the caller is not a member of (incl. malformed teamId)", async () => {
    const res = await request(app).put("/v1/teams/Bad%20Team/projects/acme")
      .set(authHeader()).send({ title: "x", status: "queued" });
    expect(res.status).toBe(403);
  });

  it("401 for an unknown/revoked key", async () => {
    await seedTeam();
    const res = await request(app).put("/v1/teams/team1/projects/acme")
      .set("Authorization", "Bearer al_unknown").send({ title: "x", status: "queued" });
    expect(res.status).toBe(401);
  });

  it("403 when the key's user is not a member of the team", async () => {
    await db().doc("teams/other").set({ name: "Other", createdBy: "u9" }); // team exists, no membership for TEST_UID
    const res = await request(app).put("/v1/teams/other/projects/acme")
      .set(authHeader()).send({ title: "x", status: "queued" });
    expect(res.status).toBe(403);
  });
});
