import { describe, it, expect } from "vitest";
import { sessionBody } from "../src/schemas.js";

describe("sessionBody schema", () => {
  it("accepts a valid session", () => {
    const r = sessionBody.safeParse({
      sessionId: "0ee0ac9d-27e2-4439-b550-933f226aaa24",
      startedAt: 1000,
      endedAt: 2000,
      entries: [
        { kind: "user", text: "hello", ts: 1000 },
        { kind: "assistant", text: "hi", ts: 1001 },
        { kind: "tool", name: "Bash", summary: "ls -la", ok: true, ts: 1002 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects sessionId that contains uppercase beyond UUID hex", () => {
    const r = sessionBody.safeParse({
      sessionId: "INVALID SESSION ID!",
      startedAt: 1000, endedAt: 2000, entries: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects text longer than 500 chars", () => {
    const r = sessionBody.safeParse({
      sessionId: "abc123de",
      startedAt: 1000, endedAt: 2000,
      entries: [{ kind: "user", text: "x".repeat(501), ts: 1000 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 2000 entries", () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ kind: "user" as const, text: "hi", ts: i }));
    const r = sessionBody.safeParse({ sessionId: "abc123de", startedAt: 0, endedAt: 1, entries });
    expect(r.success).toBe(false);
  });
});

import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

async function seed() {
  await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
  await seedMember("team1");
  await request(app).put("/v1/teams/team1/projects/proj").set(authHeader()).send({ title: "P", status: "running" });
  await request(app).put("/v1/teams/team1/projects/proj/loops/loop1").set(authHeader()).send({ goal: "g", order: 1, status: "running" });
}

describe("POST /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions", () => {
  it("creates a session and returns ok", async () => {
    await seed();
    const body = {
      sessionId: "0ee0ac9d-27e2-4439-b550-933f226aaa24",
      startedAt: 1000, endedAt: 2000,
      entries: [{ kind: "user", text: "hi", ts: 1000 }],
    };
    const res = await request(app)
      .post("/v1/teams/team1/projects/proj/loops/loop1/sessions")
      .set(authHeader()).send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("appends delta entries across pushes (preserving startedAt)", async () => {
    await seed();
    const id = "0ee0ac9d-27e2-4439-b550-933f226aaa24";
    await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader())
      .send({ sessionId: id, startedAt: 1000, endedAt: 1100, entries: [{ kind: "user", text: "first", ts: 1000 }] });
    await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader())
      .send({ sessionId: id, startedAt: 9999, endedAt: 1200, entries: [{ kind: "assistant", text: "second", ts: 1200 }] });
    const res = await request(app).get("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader());
    const session = res.body.sessions.find((s: { sessionId: string }) => s.sessionId === id);
    expect(session.entries.map((e: { text: string }) => e.text)).toEqual(["first", "second"]);
    expect(session.startedAt).toBe(1000); // first push's startedAt preserved
    expect(session.endedAt).toBe(1200);   // latest push's endedAt
  });

  it("returns 400 on invalid body", async () => {
    await seed();
    const res = await request(app)
      .post("/v1/teams/team1/projects/proj/loops/loop1/sessions")
      .set(authHeader()).send({ sessionId: "x", startedAt: "bad" });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions", () => {
  it("lists sessions ordered by startedAt", async () => {
    await seed();
    const base = { endedAt: 2000, entries: [] };
    await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader()).send({ sessionId: "2a3b4c5d-6e7f-8901-bcde-f12345678902", startedAt: 2000, ...base });
    await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader()).send({ sessionId: "1a2b3c4d-5e6f-7890-abcd-ef1234567891", startedAt: 1000, ...base });
    const res = await request(app).get("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.sessions[0].sessionId).toBe("1a2b3c4d-5e6f-7890-abcd-ef1234567891");
    expect(res.body.sessions[1].sessionId).toBe("2a3b4c5d-6e7f-8901-bcde-f12345678902");
  });
});
