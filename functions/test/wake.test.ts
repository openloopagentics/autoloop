import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { makeApp } from "../src/app.js";
import { makeRequireUser } from "../src/requireUser.js";
import { requireMember } from "../src/requireMember.js";
import { userProjectsRouter } from "../src/routes/userProjects.js";
import { errorHandler } from "../src/errors.js";

// user side (ID token), same stub as userProjects.test.ts
const stubVerify = async (t: string) => { const m = t.match(/^good-(.+)$/); if (!m) throw new Error("x"); return { uid: m[1] }; };
function userApp() {
  const a = express();
  a.use(express.json());
  a.use("/v1/u/teams/:teamId/projects", makeRequireUser(stubVerify), requireMember, userProjectsRouter);
  a.use(errorHandler);
  return a;
}
const tok = (uid: string) => ({ Authorization: `Bearer good-${uid}` });

// agent side (API key) for wake-ack
const agentApp = makeApp();

async function seedProject(slug = "web") {
  await db().doc("users/alice").set({ email: "a@x.com", isAllowed: true });
  await db().doc("teams/t1").set({ name: "T", createdBy: "alice" });
  await db().doc("teams/t1/members/alice").set({ uid: "alice", role: "member" });
  await db().doc(`teams/t1/projects/${slug}`).set({ title: "Web", status: "running", visionOwner: "loop" });
}

describe("dashboard restart signal (wake / wake-ack)", () => {
  it("member POST /wake stamps wakeRequestedAt+By on the project (even loop-owned)", async () => {
    await seedProject();
    const r = await request(userApp()).post("/v1/u/teams/t1/projects/web/wake").set(tok("alice")).send({});
    expect(r.status).toBe(200);
    const p = (await db().doc("teams/t1/projects/web").get()).data()!;
    expect(p.wakeRequestedAt).toBeTruthy();
    expect(p.wakeRequestedBy).toBe("alice");
  });

  it("404 for a missing project; 403 for a non-member", async () => {
    await seedProject();
    expect((await request(userApp()).post("/v1/u/teams/t1/projects/nope/wake").set(tok("alice")).send({})).status).toBe(404);
    await db().doc("users/eve").set({ email: "e@x.com", isAllowed: true });
    expect((await request(userApp()).post("/v1/u/teams/t1/projects/web/wake").set(tok("eve")).send({})).status).toBe(403);
  });

  it("agent POST /wake-ack clears the request; idempotent when absent", async () => {
    await seedProject();
    // seed the agent key for team t1 (helpers' authHeader is team1 — seed for t1 explicitly)
    await seedMember("t1");
    await request(userApp()).post("/v1/u/teams/t1/projects/web/wake").set(tok("alice")).send({});
    const r = await request(agentApp).post("/v1/teams/t1/projects/web/wake-ack").set(authHeader()).send({});
    expect(r.status).toBe(200);
    const p = (await db().doc("teams/t1/projects/web").get()).data()!;
    expect(p.wakeRequestedAt).toBeUndefined();
    expect(p.wakeRequestedBy).toBeUndefined();
    // second ack: still 200, no error
    expect((await request(agentApp).post("/v1/teams/t1/projects/web/wake-ack").set(authHeader()).send({})).status).toBe(200);
  });
});
