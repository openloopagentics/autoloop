import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { requireMember } from "../src/requireMember.js";
import { errorHandler } from "../src/errors.js";

// stand-in for makeRequireUser: set req.uid from a header so we test membership alone
function app() {
  const a = express();
  a.use("/v1/u/teams/:teamId/projects", (req, _res, next) => { (req as { uid?: string }).uid = req.header("x-uid") || undefined; next(); }, requireMember, (_req, res) => res.json({ ok: true }));
  a.use(errorHandler);
  return a;
}

describe("requireMember", () => {
  it("403 when uid is not a member of the team", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "x" });
    const res = await request(app()).get("/v1/u/teams/t1/projects").set("x-uid", "bob");
    expect(res.status).toBe(403);
  });
  it("passes when uid is a member", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "x" });
    await db().doc("teams/t1/members/alice").set({ uid: "alice", role: "member" });
    const res = await request(app()).get("/v1/u/teams/t1/projects").set("x-uid", "alice");
    expect(res.status).toBe(200);
  });
});
