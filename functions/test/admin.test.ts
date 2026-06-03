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
  it("GET /access-requests lists only pending", async () => {
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    await db().doc("accessRequests/u2").set({ uid: "u2", email: "u2@x.com", status: "approved" });
    const res = await request(app()).get("/v1/admin/access-requests");
    expect(res.status).toBe(200);
    expect(res.body.requests.map((r: any) => r.uid)).toEqual(["u1"]);
  });
  it("approve flips isAllowed and marks the request approved", async () => {
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    await db().doc("users/u1").set({ email: "u1@x.com", isAllowed: false, isAdmin: false });
    expect((await request(app()).post("/v1/admin/access-requests/u1").send({ decision: "approve" })).status).toBe(200);
    expect((await db().doc("users/u1").get()).data()!.isAllowed).toBe(true);
    expect((await db().doc("users/u1").get()).data()!.isAdmin).toBe(false); // untouched
    expect((await db().doc("accessRequests/u1").get()).data()!.status).toBe("approved");
  });
  it("approve provisions a users doc for an un-provisioned uid (with the request email)", async () => {
    await db().doc("accessRequests/u3").set({ uid: "u3", email: "u3@x.com", status: "pending" });
    await request(app()).post("/v1/admin/access-requests/u3").send({ decision: "approve" });
    expect((await db().doc("users/u3").get()).data()).toMatchObject({ isAllowed: true, email: "u3@x.com" });
  });
  it("deny marks denied and leaves isAllowed alone", async () => {
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    await db().doc("users/u1").set({ email: "u1@x.com", isAllowed: false });
    expect((await request(app()).post("/v1/admin/access-requests/u1").send({ decision: "deny" })).status).toBe(200);
    expect((await db().doc("accessRequests/u1").get()).data()!.status).toBe("denied");
    expect((await db().doc("users/u1").get()).data()!.isAllowed).toBe(false);
  });
  it("404 when the request does not exist; 400 on a bad decision", async () => {
    expect((await request(app()).post("/v1/admin/access-requests/ghost").send({ decision: "approve" })).status).toBe(404);
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    expect((await request(app()).post("/v1/admin/access-requests/u1").send({ decision: "bogus" })).status).toBe(400);
  });
});
