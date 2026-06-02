import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { makeRequireAdmin } from "../src/requireAdmin.js";
import { errorHandler } from "../src/errors.js";

const stub = async (t: string) => { const m = t.match(/^good-(.+)$/); if (!m) throw new Error("bad"); return { uid: m[1] }; };
function app() {
  const a = express(); a.use(express.json());
  a.use("/admin", makeRequireAdmin(stub), (req, res) => res.json({ uid: req.uid }));
  a.use(errorHandler); return a;
}
async function setUser(uid: string, isAllowed: boolean, isAdmin: boolean) {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed, isAdmin });
}

describe("requireAdmin", () => {
  it("401 no token / bad token", async () => {
    expect((await request(app()).get("/admin")).status).toBe(401);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer nope")).status).toBe(401);
  });
  it("403 when not allowed or not admin", async () => {
    await setUser("u1", true, false);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer good-u1")).status).toBe(403);
    await setUser("u2", false, true);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer good-u2")).status).toBe(403);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer good-ghost")).status).toBe(403);
  });
  it("200 + req.uid for an allowed admin", async () => {
    await setUser("boss", true, true);
    const res = await request(app()).get("/admin").set("Authorization", "Bearer good-boss");
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe("boss");
  });
});
