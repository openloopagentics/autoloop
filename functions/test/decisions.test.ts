import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { decisionBody } from "../src/schemas.js";
import { appendDecision } from "../src/services/events.js";
import { makeApp } from "../src/app.js";
import { upsertLoop } from "../src/services/loops.js";

// ── Task 1: decisionBody schema (pure — no emulator required) ─────────────

describe("decisionBody schema", () => {
  it("accepts minimal valid body {kind, summary, rationale}", () => {
    const r = decisionBody.safeParse({ kind: "goal-pick", summary: "chose goal A", rationale: "it fits" });
    expect(r.success).toBe(true);
  });

  it("accepts refs + alternatives", () => {
    const r = decisionBody.safeParse({
      kind: "approach",
      summary: "use queue",
      rationale: "lower coupling",
      alternatives: ["direct call", "event bus"],
      refs: { scenarioIds: ["s1"], taskIds: ["t1"], commitShas: ["abc123"] },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown kind", () => {
    const r = decisionBody.safeParse({ kind: "unknown-kind", summary: "s", rationale: "r" });
    expect(r.success).toBe(false);
  });

  it("rejects empty summary", () => {
    const r = decisionBody.safeParse({ kind: "stuck", summary: "", rationale: "r" });
    expect(r.success).toBe(false);
  });

  it("rejects rationale over 4096 chars", () => {
    const r = decisionBody.safeParse({ kind: "stuck", summary: "s", rationale: "x".repeat(4097) });
    expect(r.success).toBe(false);
  });

  it("rejects a refs id with a bad pattern ('Bad Id')", () => {
    const r = decisionBody.safeParse({
      kind: "goal-pick",
      summary: "s",
      rationale: "r",
      refs: { scenarioIds: ["Bad Id"] },
    });
    expect(r.success).toBe(false);
  });
});

// ── Task 2: appendDecision service (emulator-backed) ────────────────────────

describe("appendDecision service", () => {
  it("writes the decision doc under loops/L1/decisions and returns a ULID id", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "u1" });
    await seedMember("t1");
    await db().doc("teams/t1/projects/acme").set({ title: "Acme", status: "running" });
    await upsertLoop("t1", "acme", "l1", { goal: "build", order: 1, status: "running" });

    const id = await appendDecision(
      "t1", "acme",
      { kind: "goal-pick", summary: "s", rationale: "r", refs: { scenarioIds: ["s1"] } },
      "l1",
    );

    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const d = (await db().doc(`teams/t1/projects/acme/loops/l1/decisions/${id}`).get()).data()!;
    expect(d.kind).toBe("goal-pick");
    expect(d.by).toBe("driver");
    expect(d.refs?.scenarioIds).toEqual(["s1"]);
    expect(d.createdAt).toBeTruthy();
  });

  it("omits absent optional fields from the stored doc (sparse write)", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "u1" });
    await seedMember("t1");
    await db().doc("teams/t1/projects/acme").set({ title: "Acme", status: "running" });

    const id = await appendDecision("t1", "acme", { kind: "stuck", summary: "s", rationale: "r" });
    const d = (await db().doc(`teams/t1/projects/acme/decisions/${id}`).get()).data()!;
    expect("alternatives" in d).toBe(false); // omitted → key absent (byte-stable)
    expect("refs" in d).toBe(false);
  });

  it("404s when the loop does not exist", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "u1" });
    await seedMember("t1");
    await db().doc("teams/t1/projects/acme").set({ title: "Acme", status: "running" });
    await expect(appendDecision("t1", "acme", { kind: "stuck", summary: "s", rationale: "r" }, "ghost"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "u1" });
    await seedMember("t1");
    await expect(appendDecision("t1", "ghost", { kind: "stuck", summary: "s", rationale: "r" }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

// ── Task 3: decisionsRouter + mounting ──────────────────────────────────────

const app = makeApp();

async function seedProject(teamId = "t1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

describe("POST /v1/teams/:teamId/projects/:slug/decisions (project-direct)", () => {
  it("returns 200 + ULID id and writes the doc at the project level (loopId undefined)", async () => {
    await seedProject();

    const res = await request(app)
      .post("/v1/teams/t1/projects/acme/decisions")
      .set(authHeader())
      .send({ kind: "approach", summary: "s", rationale: "r" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect((await db().doc(`teams/t1/projects/acme/decisions/${res.body.id}`).get()).exists).toBe(true);
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/loops/:loopId/decisions", () => {
  it("returns 200 { ok: true, id } for a valid decision", async () => {
    await seedProject();
    await upsertLoop("t1", "acme", "l1", { goal: "build", order: 1, status: "running" });

    const res = await request(app)
      .post("/v1/teams/t1/projects/acme/loops/l1/decisions")
      .set(authHeader())
      .send({ kind: "goal-pick", summary: "s", rationale: "r" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("returns 400 for an unknown kind", async () => {
    await seedProject();
    await upsertLoop("t1", "acme", "l1", { goal: "build", order: 1, status: "running" });

    const res = await request(app)
      .post("/v1/teams/t1/projects/acme/loops/l1/decisions")
      .set(authHeader())
      .send({ kind: "nope", summary: "s", rationale: "r" });

    expect(res.status).toBe(400);
  });
});
