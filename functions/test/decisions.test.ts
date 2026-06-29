import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { decisionBody } from "../src/schemas.js";
import { appendDecision } from "../src/services/events.js";
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
    await upsertLoop("t1", "acme", "L1", { goal: "build", order: 1, status: "running" });

    const id = await appendDecision(
      "t1", "acme",
      { kind: "goal-pick", summary: "s", rationale: "r", refs: { scenarioIds: ["s1"] } },
      "L1",
    );

    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const d = (await db().doc(`teams/t1/projects/acme/loops/L1/decisions/${id}`).get()).data()!;
    expect(d.kind).toBe("goal-pick");
    expect(d.by).toBe("driver");
    expect(d.refs?.scenarioIds).toEqual(["s1"]);
    expect(d.createdAt).toBeTruthy();
  });
});
