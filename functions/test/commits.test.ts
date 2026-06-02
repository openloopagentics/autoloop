import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
}

async function setup() {
  await seedTeam();
  await request(app).put("/v1/teams/team1/projects/acme").set(authHeader()).send({ title: "Acme", status: "running" });
  await request(app).put("/v1/teams/team1/projects/acme/phases/p1").set(authHeader()).send({ name: "A", order: 1, status: "running" });
}

describe("PUT .../commits/:sha", () => {
  it("404s when the phase does not exist", async () => {
    await seedTeam();
    await request(app).put("/v1/teams/team1/projects/acme").set(authHeader()).send({ title: "Acme", status: "running" });
    const res = await request(app).put("/v1/teams/team1/projects/acme/phases/ghost/commits/abc")
      .set(authHeader()).send({ message: "m", author: "a" });
    expect(res.status).toBe(404);
  });

  it("records a commit with committedAt and stamps createdAt", async () => {
    await setup();
    const res = await request(app).put("/v1/teams/team1/projects/acme/phases/p1/commits/abc123")
      .set(authHeader()).send({ message: "init", author: "agent", committedAt: "2026-06-01T10:00:00Z" });
    expect(res.status).toBe(200);

    const doc = (await db().doc("teams/team1/projects/acme/phases/p1/commits/abc123").get()).data()!;
    expect(doc.message).toBe("init");
    expect(doc.author).toBe("agent");
    expect(doc.createdAt).toBeDefined();
    expect(doc.committedAt.toMillis()).toBe(Date.parse("2026-06-01T10:00:00Z"));
  });

  it("requires message and author", async () => {
    await setup();
    const res = await request(app).put("/v1/teams/team1/projects/acme/phases/p1/commits/abc")
      .set(authHeader()).send({ message: "only message" });
    expect(res.status).toBe(400);
  });

  it("requires message and author even on update (always required, not just create)", async () => {
    await setup();
    await request(app).put("/v1/teams/team1/projects/acme/phases/p1/commits/abc")
      .set(authHeader()).send({ message: "m", author: "a" }).expect(200);
    // re-PUT the same sha without author -> 400 (commit is never a partial update)
    const res = await request(app).put("/v1/teams/team1/projects/acme/phases/p1/commits/abc")
      .set(authHeader()).send({ message: "m" });
    expect(res.status).toBe(400);
  });

  it("is idempotent on the same sha", async () => {
    await setup();
    const send = () => request(app).put("/v1/teams/team1/projects/acme/phases/p1/commits/abc")
      .set(authHeader()).send({ message: "m", author: "a" });
    await send();
    const first = (await db().doc("teams/team1/projects/acme/phases/p1/commits/abc").get()).data()!.createdAt;
    await send();
    const second = (await db().doc("teams/team1/projects/acme/phases/p1/commits/abc").get()).data()!.createdAt;
    expect(second.toMillis()).toBe(first.toMillis());
  });
});
