import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember, authHeader } from "./helpers.js";
import { db } from "../src/firestore.js";
import { upsertIdea, listIdeas } from "../src/services/ideas.js";
import request from "supertest";
import { makeApp } from "../src/app.js";

const app = makeApp();

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

describe("upsertIdea", () => {
  it("requires title, status AND order on create", async () => {
    await seedProject();
    await expect(upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed" }, "agent")).rejects.toMatchObject({ httpStatus: 400 });
    await expect(upsertIdea("team1", "acme", "i1", { title: "X", order: 1 }, "agent")).rejects.toMatchObject({ httpStatus: 400 });
    await expect(upsertIdea("team1", "acme", "i1", { status: "proposed", order: 1 }, "agent")).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("creates with createdAt, by from the arg, decidedAt:null", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "Dark mode", rationale: "asked", status: "proposed", order: 100, originLoopId: "loop-1" }, "agent");
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.title).toBe("Dark mode");
    expect(d.rationale).toBe("asked");
    expect(d.status).toBe("proposed");
    expect(d.order).toBe(100);
    expect(d.originLoopId).toBe("loop-1");
    expect(d.by).toBe("agent");
    expect(d.createdAt).toBeDefined();
    expect(d.decidedAt).toBeNull();
  });

  it("stamps by:'user' when created via the user path arg", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 1 }, "user");
    expect((await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.by).toBe("user");
  });

  it("partial update sets only provided fields and never touches by/createdAt", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 100 }, "agent");
    const before = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    await upsertIdea("team1", "acme", "i1", { order: 10 }, "user"); // user reorder must not flip by
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.order).toBe(10);
    expect(d.title).toBe("X");
    expect(d.by).toBe("agent");
    expect(d.createdAt.toMillis()).toBe(before.createdAt.toMillis());
  });

  it("stamps decidedAt once on first accept and keeps it stable across re-PUTs", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 1 }, "agent");
    await upsertIdea("team1", "acme", "i1", { status: "accepted" }, "user");
    const decided1 = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.decidedAt;
    expect(decided1).not.toBeNull();
    await upsertIdea("team1", "acme", "i1", { status: "rejected" }, "user"); // flip — decidedAt unchanged
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.status).toBe("rejected");
    expect(d.decidedAt.toMillis()).toBe(decided1.toMillis());
  });

  it("stamps decidedAt when the idea is CREATED directly as accepted (and as rejected)", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "accepted", order: 1 }, "user");
    expect((await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.decidedAt).not.toBeNull();
    await upsertIdea("team1", "acme", "i2", { title: "Y", status: "rejected", order: 2 }, "user");
    expect((await db().doc("teams/team1/projects/acme/ideas/i2").get()).data()!.decidedAt).not.toBeNull();
  });

  it("does NOT stamp decidedAt for proposed or done", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 1 }, "agent");
    await upsertIdea("team1", "acme", "i1", { status: "done", builtInLoopId: "loop-2" }, "agent");
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.decidedAt).toBeNull();
    expect(d.builtInLoopId).toBe("loop-2");
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(upsertIdea("team1", "ghost", "i1", { title: "X", status: "proposed", order: 1 }, "agent"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("listIdeas", () => {
  it("sorts by status band (accepted, proposed, rejected, done), then order, then createdAt; serializes timestamps", async () => {
    await seedProject();
    // insertion order is deliberately scrambled; same-band order ties fall back to createdAt
    await upsertIdea("team1", "acme", "done-1",     { title: "D", status: "done",     order: 1 },   "agent");
    await upsertIdea("team1", "acme", "prop-late",  { title: "P2", status: "proposed", order: 100 }, "agent");
    await upsertIdea("team1", "acme", "rej-1",      { title: "R", status: "rejected", order: 1 },   "user");
    await upsertIdea("team1", "acme", "prop-early", { title: "P1", status: "proposed", order: 100 }, "agent"); // tie on order — created later
    await upsertIdea("team1", "acme", "prop-first", { title: "P0", status: "proposed", order: 10 },  "agent");
    await upsertIdea("team1", "acme", "acc-1",      { title: "A", status: "accepted", order: 50 },  "user");

    const ideas = await listIdeas("team1", "acme");
    expect(ideas.map((i) => i.id)).toEqual(["acc-1", "prop-first", "prop-late", "prop-early", "rej-1", "done-1"]);
    expect(typeof ideas[0].createdAt).toBe("string"); // ISO, like the messages GET
    expect(typeof ideas[0].updatedAt).toBe("string");
    expect(ideas[0].decidedAt === null || typeof ideas[0].decidedAt === "string").toBe(true);
    expect(ideas[0].by).toBe("user");
  });

  it("returns [] for a project with no ideas and 404s on a missing project", async () => {
    await seedProject();
    expect(await listIdeas("team1", "acme")).toEqual([]);
    await expect(listIdeas("team1", "ghost")).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("ideas agent API", () => {
  it("PUT creates an idea and stamps by:'agent' (a client-supplied by is ignored)", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "Dark mode", status: "proposed", order: 100, by: "user" }); // by must be DROPPED
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.title).toBe("Dark mode");
    expect(d.by).toBe("agent"); // from the API-key path, not the body
  });

  it("PUT 400s when creating without the title+status+order trio", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "X", status: "proposed" });
    expect(res.status).toBe(400);
  });

  it("PUT applies a partial update to an existing idea", async () => {
    await seedProject();
    await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "X", status: "proposed", order: 100 });
    const res = await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ status: "done", builtInLoopId: "loop-2" });
    expect(res.status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.status).toBe("done");
    expect(d.builtInLoopId).toBe("loop-2");
    expect(d.title).toBe("X");
  });

  it("PUT 400s on an unknown status enum and 404s on a missing project", async () => {
    await seedProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "X", status: "maybe", order: 1 })).status).toBe(400);
    expect((await request(app).put("/v1/teams/team1/projects/ghost/ideas/i1").set(authHeader())
      .send({ title: "X", status: "proposed", order: 1 })).status).toBe(404);
  });

  it("GET lists ideas band-sorted with serialized timestamps", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "p1", { title: "P", status: "proposed", order: 5 }, "agent");
    await upsertIdea("team1", "acme", "a1", { title: "A", status: "accepted", order: 99 }, "user");
    await upsertIdea("team1", "acme", "r1", { title: "R", status: "rejected", order: 1 }, "user");
    const res = await request(app).get("/v1/teams/team1/projects/acme/ideas").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ideas.map((i: { id: string }) => i.id)).toEqual(["a1", "p1", "r1"]);
    expect(typeof res.body.ideas[0].createdAt).toBe("string");
    expect(typeof res.body.ideas[0].decidedAt).toBe("string"); // accepted → decided
  });
});
