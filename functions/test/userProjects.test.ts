import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { makeRequireUser } from "../src/requireUser.js";
import { requireMember } from "../src/requireMember.js";
import { userProjectsRouter } from "../src/routes/userProjects.js";
import { errorHandler } from "../src/errors.js";

const stubVerify = async (t: string) => { const m = t.match(/^good-(.+)$/); if (!m) throw new Error("x"); return { uid: m[1] }; };
function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1/u/teams/:teamId/projects", makeRequireUser(stubVerify), requireMember, userProjectsRouter);
  a.use(errorHandler);
  return a;
}
const tok = (uid: string) => ({ Authorization: `Bearer good-${uid}` });
async function seed(uid = "alice") {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed: true });
  await db().doc("teams/t1").set({ name: "T", createdBy: uid });
  await db().doc(`teams/t1/members/${uid}`).set({ uid, role: "member" });
}
const rubric = { criteria: [{ id: "c", name: "C", weight: 1, max: 5 }] };

describe("user vision write path", () => {
  it("creates a web project (visionOwner web), then goal/scenario/document", async () => {
    await seed();
    expect((await request(app()).put("/v1/u/teams/t1/projects/web").set(tok("alice")).send({ title: "Web", status: "running" })).status).toBe(200);
    let p = (await db().doc("teams/t1/projects/web").get()).data()!;
    expect(p.visionOwner).toBe("web");
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice")).send({ title: "G" })).status).toBe(200);
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/scenarios/s1").set(tok("alice")).send({ goalId: "g1", title: "S", rubric })).status).toBe(200);
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/documents/d1").set(tok("alice")).send({ kind: "vision", title: "V", format: "markdown", content: "# V" })).status).toBe(200);
    expect((await db().doc("teams/t1/projects/web/scenarios/s1").get()).data()!.title).toBe("S");
  });
  it("403 for a non-member; 401 for a bad token", async () => {
    await seed();
    await db().doc("users/bob").set({ email: "b@x.com", isAllowed: true });
    expect((await request(app()).put("/v1/u/teams/t1/projects/web").set(tok("bob")).send({ title: "W", status: "running" })).status).toBe(403);
    expect((await request(app()).put("/v1/u/teams/t1/projects/web").set({ Authorization: "Bearer nope" }).send({ title: "W", status: "running" })).status).toBe(401);
  });
  it("409 when the project is loop-owned", async () => {
    await seed();
    await db().doc("teams/t1/projects/web").set({ slug: "web", title: "W", status: "running", visionOwner: "loop" });
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice")).send({ title: "G" })).status).toBe(409);
  });
  it("deletes a goal", async () => {
    await seed();
    await request(app()).put("/v1/u/teams/t1/projects/web").set(tok("alice")).send({ title: "W", status: "running" });
    await request(app()).put("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice")).send({ title: "G" });
    expect((await request(app()).delete("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice"))).status).toBe(200);
    expect((await db().doc("teams/t1/projects/web/goals/g1").get()).exists).toBe(false);
  });
});
