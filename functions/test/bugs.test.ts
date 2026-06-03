import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember, authHeader } from "./helpers.js";
import { db } from "../src/firestore.js";
import { upsertBug } from "../src/services/bugs.js";
import { upsertLoop } from "../src/services/loops.js";
import request from "supertest";
import { makeApp } from "../src/app.js";

const app = makeApp();

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

describe("upsertBug", () => {
  it("requires title and status on create", async () => {
    await seedProject();
    await expect(upsertBug("team1", "acme", "b1", { title: "X" })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(upsertBug("team1", "acme", "b1", { status: "open" })).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("creates a bug project-direct with createdAt + fixedAt:null", async () => {
    await seedProject();
    await upsertBug("team1", "acme", "b1", { title: "Login breaks", status: "open", severity: "high", scenarioId: "s1", taskId: "t1" });
    const d = (await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!;
    expect(d.title).toBe("Login breaks");
    expect(d.status).toBe("open");
    expect(d.severity).toBe("high");
    expect(d.scenarioId).toBe("s1");
    expect(d.createdAt).toBeDefined();
    expect(d.fixedAt).toBeNull();
  });

  it("updates in place and stamps fixedAt once on first fix (stable across re-PUTs)", async () => {
    await seedProject();
    await upsertBug("team1", "acme", "b1", { title: "X", status: "open" });
    await upsertBug("team1", "acme", "b1", { status: "fixed" });
    const fixed1 = (await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!.fixedAt;
    expect(fixed1).not.toBeNull();
    // re-PUT fixed again -> fixedAt unchanged
    await upsertBug("team1", "acme", "b1", { status: "fixed", title: "X2" });
    const d = (await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!;
    expect(d.title).toBe("X2");
    expect(d.fixedAt.toMillis()).toBe(fixed1.toMillis());
  });

  it("writes loop-scoped under loops/{id}/bugs and 404s when the loop is absent", async () => {
    await seedProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    await upsertBug("team1", "acme", "b1", { title: "X", status: "open" }, "l1");
    expect((await db().doc("teams/team1/projects/acme/loops/l1/bugs/b1").get()).exists).toBe(true);
    expect((await db().doc("teams/team1/projects/acme/bugs/b1").get()).exists).toBe(false);
    await expect(upsertBug("team1", "acme", "b2", { title: "X", status: "open" }, "ghost"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(upsertBug("team1", "ghost", "b1", { title: "X", status: "open" }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("PUT bugs (API)", () => {
  it("creates a bug via the project-direct route", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/bugs/b1").set(authHeader())
      .send({ title: "Login breaks", status: "open" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect((await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!.title).toBe("Login breaks");
  });

  it("creates a bug via the loop-scoped route", async () => {
    await seedProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    const res = await request(app).put("/v1/teams/team1/projects/acme/loops/l1/bugs/b1").set(authHeader())
      .send({ title: "X", status: "open" });
    expect(res.status).toBe(200);
    expect((await db().doc("teams/team1/projects/acme/loops/l1/bugs/b1").get()).exists).toBe(true);
  });

  it("400s when creating without title+status", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/bugs/b1").set(authHeader())
      .send({ title: "X" });
    expect(res.status).toBe(400);
  });

  it("400s on an unknown status enum", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/bugs/b1").set(authHeader())
      .send({ title: "X", status: "wontfix" });
    expect(res.status).toBe(400);
  });
});
