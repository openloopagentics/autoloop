import { describe, it, expect } from "vitest";
import { decisionBody } from "../src/schemas.js";

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
