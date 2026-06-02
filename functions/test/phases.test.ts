import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

async function createProject(slug = "acme") {
  await request(app).put(`/v1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}

describe("PUT /v1/projects/:slug/phases/:phaseId", () => {
  it("404s when the project does not exist", async () => {
    const res = await request(app).put("/v1/projects/ghost/phases/p1").set(authHeader())
      .send({ name: "Design", order: 1, status: "running" });
    expect(res.status).toBe(404);
  });

  it("creates a phase, stamps startedAt, and sets it as current", async () => {
    await createProject();
    const res = await request(app).put("/v1/projects/acme/phases/p1").set(authHeader())
      .send({ name: "Design", order: 1, status: "running" });
    expect(res.status).toBe(200);

    const phase = (await db().doc("projects/acme/phases/p1").get()).data()!;
    expect(phase.startedAt).toBeDefined();
    expect(phase.endedAt ?? null).toBeNull();

    const project = (await db().doc("projects/acme").get()).data()!;
    expect(project.currentPhaseId).toBe("p1");
  });

  it("requires name/order/status on create", async () => {
    await createProject();
    const res = await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ name: "Design" });
    expect(res.status).toBe(400);
  });

  it("advances currentPhaseId to the next non-terminal phase by order when one completes", async () => {
    await createProject();
    await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ name: "A", order: 1, status: "running" });
    await request(app).put("/v1/projects/acme/phases/p2").set(authHeader()).send({ name: "B", order: 2, status: "queued" });
    expect((await db().doc("projects/acme").get()).data()!.currentPhaseId).toBe("p1");

    await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("projects/acme").get()).data()!.currentPhaseId).toBe("p2");
  });

  it("sets currentPhaseId to null when all phases are terminal", async () => {
    await createProject();
    await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ name: "A", order: 1, status: "running" });
    await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("projects/acme").get()).data()!.currentPhaseId ?? null).toBeNull();
  });

  it("stamps endedAt once and does not overwrite it on retry", async () => {
    await createProject();
    await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ name: "A", order: 1, status: "running" });
    await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ status: "completed" });
    const first = (await db().doc("projects/acme/phases/p1").get()).data()!.endedAt;
    await request(app).put("/v1/projects/acme/phases/p1").set(authHeader()).send({ status: "completed" });
    const second = (await db().doc("projects/acme/phases/p1").get()).data()!.endedAt;
    expect(second.toMillis()).toBe(first.toMillis());
  });
});
