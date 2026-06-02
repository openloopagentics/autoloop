import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { hashKey } from "../src/apiKeys.js";
import { requireApiKeyMember } from "../src/requireApiKeyMember.js";
import { errorHandler } from "../src/errors.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1/teams/:teamId/projects", requireApiKeyMember, (req, res) => res.json({ uid: req.uid }));
  a.use(errorHandler);
  return a;
}
async function seedKey(plaintext: string, uid: string) {
  await db().doc(`apiKeys/${hashKey(plaintext)}`).set({ uid, label: "t", prefix: plaintext.slice(0, 8) });
}
async function seedMember(teamId: string, uid: string) {
  await db().doc(`teams/${teamId}/members/${uid}`).set({ uid, role: "member" });
}

describe("requireApiKeyMember", () => {
  it("401 when no key", async () => {
    expect((await request(app()).get("/v1/teams/t1/projects")).status).toBe(401);
  });
  it("401 when the key is unknown/revoked", async () => {
    expect((await request(app()).get("/v1/teams/t1/projects").set("Authorization", "Bearer dl_nope")).status).toBe(401);
  });
  it("403 when the key's user is not a member of the team", async () => {
    await seedKey("dl_k", "alice");
    expect((await request(app()).get("/v1/teams/t1/projects").set("Authorization", "Bearer dl_k")).status).toBe(403);
  });
  it("200 + sets req.uid when the user is a member", async () => {
    await seedKey("dl_k", "alice");
    await seedMember("t1", "alice");
    const res = await request(app()).get("/v1/teams/t1/projects").set("Authorization", "Bearer dl_k");
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe("alice");
  });
});
