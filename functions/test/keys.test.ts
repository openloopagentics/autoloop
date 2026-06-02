import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { keysRouter } from "../src/routes/keys.js";
import { makeApp } from "../src/app.js";
import { errorHandler } from "../src/errors.js";

function appAs(uid: string) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.uid = uid; next(); });
  a.use("/v1/keys", keysRouter);
  a.use(errorHandler);
  return a;
}

describe("/v1/keys is guarded in the real app", () => {
  // Exercises the actual makeApp() wiring: /v1/keys must sit behind requireUser.
  // No token -> 401 before any verification, so this needs no Auth emulator.
  const app = makeApp();
  it("rejects unauthenticated key requests (401)", async () => {
    expect((await request(app).post("/v1/keys").send({ label: "x" })).status).toBe(401);
    expect((await request(app).get("/v1/keys")).status).toBe(401);
    expect((await request(app).delete("/v1/keys/abc")).status).toBe(401);
  });
});

describe("/v1/keys", () => {
  it("POST mints a key (201) and returns plaintext once", async () => {
    const res = await request(appAs("alice")).post("/v1/keys").send({ label: "laptop" });
    expect(res.status).toBe(201);
    expect(res.body.key.startsWith("dl_")).toBe(true);
    expect(res.body.label).toBe("laptop");
    const doc = (await db().doc(`apiKeys/${res.body.id}`).get()).data()!;
    expect(doc.uid).toBe("alice");
    expect(doc.key).toBeUndefined();
  });

  it("POST rejects an empty/oversized label (400)", async () => {
    expect((await request(appAs("alice")).post("/v1/keys").send({ label: "" })).status).toBe(400);
    expect((await request(appAs("alice")).post("/v1/keys").send({ label: "x".repeat(101) })).status).toBe(400);
  });

  it("GET lists the caller's keys without plaintext", async () => {
    await request(appAs("alice")).post("/v1/keys").send({ label: "a1" });
    await request(appAs("bob")).post("/v1/keys").send({ label: "b1" });
    const res = await request(appAs("alice")).get("/v1/keys");
    expect(res.status).toBe(200);
    expect(res.body.keys.length).toBe(1);
    expect(res.body.keys[0].key).toBeUndefined();
  });

  it("DELETE revokes own key (200); 404 for someone else's", async () => {
    const minted = await request(appAs("alice")).post("/v1/keys").send({ label: "a1" });
    expect((await request(appAs("bob")).delete(`/v1/keys/${minted.body.id}`)).status).toBe(404);
    expect((await request(appAs("alice")).delete(`/v1/keys/${minted.body.id}`)).status).toBe(200);
    expect((await db().doc(`apiKeys/${minted.body.id}`).get()).exists).toBe(false);
  });
});
