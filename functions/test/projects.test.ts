import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

describe("PUT /v1/projects/:slug", () => {
  it("rejects unauthenticated writes", async () => {
    const res = await request(app).put("/v1/projects/acme").send({ title: "X", status: "queued" });
    expect(res.status).toBe(401);
  });

  it("creates a project and stamps timestamps", async () => {
    const res = await request(app)
      .put("/v1/projects/acme")
      .set(authHeader())
      .send({ title: "Acme", status: "queued" });
    expect(res.status).toBe(200);

    const doc = await db().doc("projects/acme").get();
    expect(doc.exists).toBe(true);
    expect(doc.data()!.title).toBe("Acme");
    expect(doc.data()!.createdAt).toBeDefined();
    expect(doc.data()!.updatedAt).toBeDefined();
    expect(doc.data()!.currentPhaseId ?? null).toBeNull();
  });

  it("requires title and status on create", async () => {
    const res = await request(app).put("/v1/projects/acme").set(authHeader()).send({ title: "Acme" });
    expect(res.status).toBe(400);
  });

  it("merges on update and does not overwrite createdAt", async () => {
    await request(app).put("/v1/projects/acme").set(authHeader()).send({ title: "Acme", status: "queued" });
    const first = (await db().doc("projects/acme").get()).data()!.createdAt;

    const res = await request(app).put("/v1/projects/acme").set(authHeader()).send({ status: "running" });
    expect(res.status).toBe(200);
    const doc = (await db().doc("projects/acme").get()).data()!;
    expect(doc.status).toBe("running");
    expect(doc.title).toBe("Acme"); // unchanged
    expect(doc.createdAt.toMillis()).toBe(first.toMillis()); // not overwritten
  });

  it("ignores client-supplied server-owned fields", async () => {
    await request(app)
      .put("/v1/projects/acme")
      .set(authHeader())
      .send({ title: "Acme", status: "queued", currentPhaseId: "hacked" });
    const doc = (await db().doc("projects/acme").get()).data()!;
    expect(doc.currentPhaseId ?? null).toBeNull();
  });

  it("rejects an invalid slug", async () => {
    const res = await request(app).put("/v1/projects/Bad%20Slug").set(authHeader()).send({ title: "x", status: "queued" });
    expect(res.status).toBe(400);
  });
});
