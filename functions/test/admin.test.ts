import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { adminRouter } from "../src/routes/admin.js";
import { errorHandler } from "../src/errors.js";

function app() {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { req.uid = "boss"; next(); });
  a.use("/v1/admin", adminRouter);
  a.use(errorHandler); return a;
}

describe("admin routes", () => {
  it("GET /users lists users with flags", async () => {
    await db().doc("users/a").set({ email: "a@x.com", isAllowed: true, isAdmin: false });
    await db().doc("users/b").set({ email: "b@x.com", isAllowed: false });
    const res = await request(app()).get("/v1/admin/users");
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.users.map((u: any) => [u.uid, u]));
    expect(byId.a).toMatchObject({ email: "a@x.com", isAllowed: true, isAdmin: false });
    expect(byId.b).toMatchObject({ isAllowed: false, isAdmin: false });
  });
  it("PUT sets isAllowed on an existing user", async () => {
    await db().doc("users/a").set({ email: "a@x.com", isAllowed: false, isAdmin: false });
    expect((await request(app()).put("/v1/admin/users/a").send({ isAllowed: true })).status).toBe(200);
    const d = (await db().doc("users/a").get()).data()!;
    expect(d.isAllowed).toBe(true);
    expect(d.isAdmin).toBe(false); // untouched
  });
  it("PUT creates a doc (with email) for an un-provisioned uid", async () => {
    expect((await request(app()).put("/v1/admin/users/NewUid_123").send({ isAllowed: true, email: "n@x.com" })).status).toBe(200);
    const d = (await db().doc("users/NewUid_123").get()).data()!;
    expect(d).toMatchObject({ isAllowed: true, email: "n@x.com" });
  });
  it("400 on a non-boolean isAllowed", async () => {
    expect((await request(app()).put("/v1/admin/users/a").send({ isAllowed: "yes" })).status).toBe(400);
  });
});
