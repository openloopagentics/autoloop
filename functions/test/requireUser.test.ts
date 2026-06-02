import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { makeRequireUser } from "../src/requireUser.js";
import { errorHandler } from "../src/errors.js";

const stubVerify = async (token: string) => {
  const m = token.match(/^good-(.+)$/);
  if (!m) throw new Error("invalid");
  return { uid: m[1] };
};

function app() {
  const a = express();
  a.use(express.json());
  a.use("/me", makeRequireUser(stubVerify), (req, res) => res.json({ uid: req.uid }));
  a.use(errorHandler);
  return a;
}
async function allow(uid: string, isAllowed = true) {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed });
}

describe("requireUser", () => {
  it("401 when no bearer token", async () => {
    expect((await request(app()).get("/me")).status).toBe(401);
  });
  it("401 when the token fails verification", async () => {
    expect((await request(app()).get("/me").set("Authorization", "Bearer nope")).status).toBe(401);
  });
  it("403 when the user is not isAllowed (or has no user doc)", async () => {
    await allow("carol", false);
    expect((await request(app()).get("/me").set("Authorization", "Bearer good-carol")).status).toBe(403);
    expect((await request(app()).get("/me").set("Authorization", "Bearer good-ghost")).status).toBe(403);
  });
  it("200 + sets req.uid for an allowlisted user", async () => {
    await allow("alice");
    const res = await request(app()).get("/me").set("Authorization", "Bearer good-alice");
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe("alice");
  });
});
