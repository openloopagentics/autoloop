import { describe, it, expect } from "vitest";
import { idPattern, projectBody, phaseBody, commitBody, goalBody, scenarioBody, taskBody, documentBody, scoreBody, testRunBody, revisionBody, bugBody, verificationBody, ideaBody } from "../src/schemas.js";

describe("idPattern", () => {
  it("accepts safe slugs and rejects unsafe ones", () => {
    expect(idPattern.test("acme-web")).toBe(true);
    expect(idPattern.test("a.b_c-1")).toBe(true);
    expect(idPattern.test("acme/web")).toBe(false); // no slashes (would break path routing)
    expect(idPattern.test("Bad Slug!")).toBe(false);
    expect(idPattern.test("")).toBe(false);
  });
});

describe("projectBody", () => {
  it("accepts a partial body and rejects bad status", () => {
    expect(projectBody.safeParse({ status: "running" }).success).toBe(true);
    expect(projectBody.safeParse({}).success).toBe(true);
    expect(projectBody.safeParse({ status: "nope" }).success).toBe(false);
  });

  it("rejects design.content over 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    const r = projectBody.safeParse({ design: { format: "markdown", content: big } });
    expect(r.success).toBe(false);
  });

  it("strips server-owned fields", () => {
    const r = projectBody.parse({ status: "running", currentPhaseId: "x", createdAt: "y" });
    expect(r).not.toHaveProperty("currentPhaseId");
    expect(r).not.toHaveProperty("createdAt");
  });
});

describe("phaseBody", () => {
  it("accepts name/order/status and validates types", () => {
    expect(phaseBody.safeParse({ name: "Design", order: 1, status: "queued" }).success).toBe(true);
    expect(phaseBody.safeParse({ order: "first" }).success).toBe(false);
  });
});

describe("commitBody", () => {
  it("validates committedAt as ISO datetime", () => {
    expect(commitBody.safeParse({ message: "m", author: "a", committedAt: "2026-06-01T10:00:00Z" }).success).toBe(true);
    expect(commitBody.safeParse({ message: "m", author: "a", committedAt: "not-a-date" }).success).toBe(false);
  });
});

describe("loop-contract schemas", () => {
  it("scenario rubric requires criteria with positive weight and max>=1", () => {
    expect(scenarioBody.safeParse({ goalId: "g1", title: "S", rubric: { criteria: [{ id: "c1", name: "Correctness", weight: 2, max: 5 }] } }).success).toBe(true);
    expect(scenarioBody.safeParse({ rubric: { criteria: [{ id: "c1", name: "x", weight: 0, max: 5 }] } }).success).toBe(false);
    expect(scenarioBody.safeParse({ threshold: 150 }).success).toBe(false);
  });
  it("task scenarioIds must be valid ids", () => {
    expect(taskBody.safeParse({ phaseId: "p1", title: "T", order: 1, status: "running", scenarioIds: ["s1", "s2"] }).success).toBe(true);
    expect(taskBody.safeParse({ scenarioIds: ["Bad Id"] }).success).toBe(false);
  });
  it("score criteria are non-negative integers; composite is 0..100", () => {
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: 3 }, composite: 80 }).success).toBe(true);
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: -1 }, composite: 80 }).success).toBe(false);
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: 3 }, composite: 101 }).success).toBe(false);
  });
  it("rejects a score with empty criteria", () => {
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: {}, composite: 80 }).success).toBe(false);
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: 3 }, composite: 80 }).success).toBe(true);
  });
  it("document content is capped at 100KB and format is markdown|url", () => {
    expect(documentBody.safeParse({ kind: "vision", title: "V", format: "markdown", content: "x" }).success).toBe(true);
    expect(documentBody.safeParse({ format: "pdf" }).success).toBe(false);
    expect(documentBody.safeParse({ content: "x".repeat(100 * 1024 + 1) }).success).toBe(false);
  });
  it("goal/testRun/revision basic shapes", () => {
    expect(goalBody.safeParse({ title: "G", order: 1 }).success).toBe(true);
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: 8, failed: 1, issues: ["flaky"] }).success).toBe(true);
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: -1, failed: 0 }).success).toBe(false);
    expect(revisionBody.safeParse({ trigger: { scenarioId: "s1", reason: "short" }, changes: [{ op: "drop", taskId: "t9" }] }).success).toBe(true);
    expect(revisionBody.safeParse({ trigger: { scenarioId: "s1", reason: "x" }, changes: [{ op: "bogus", taskId: "t9" }] }).success).toBe(false);
  });
});

describe("bugBody", () => {
  it("accepts a minimal open bug", () => {
    expect(bugBody.safeParse({ title: "X", status: "open" }).success).toBe(true);
  });
  it("accepts the optional fields", () => {
    expect(bugBody.safeParse({ title: "X", status: "fixed", description: "d", scenarioId: "s1", taskId: "t1", severity: "high" }).success).toBe(true);
  });
  it("rejects an unknown status", () => {
    expect(bugBody.safeParse({ title: "X", status: "wontfix" }).success).toBe(false);
  });
  it("rejects an unknown severity", () => {
    expect(bugBody.safeParse({ title: "X", status: "open", severity: "blocker" }).success).toBe(false);
  });
  it("rejects a non-idPattern scenarioId", () => {
    expect(bugBody.safeParse({ title: "X", status: "open", scenarioId: "Bad Id" }).success).toBe(false);
  });
  it("drops unknown keys (plain z.object)", () => {
    const parsed = bugBody.parse({ title: "X", status: "open", createdAt: "nope" });
    expect("createdAt" in parsed).toBe(false);
  });
});

describe("verificationBody", () => {
  it("accepts a minimal verification", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", verdict: "confirmed" }).success).toBe(true);
  });
  it("accepts an UPPERCASE ULID testRunId (deliberately NOT idPattern)", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01HZXYABCDEF0123456789ABCD", verdict: "refuted" }).success).toBe(true);
  });
  it("accepts the optional fields", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", taskId: "t1", testRunId: "01A", verdict: "confirmed", summary: "npm test → 6/6", by: "verifier" }).success).toBe(true);
  });
  it("rejects an unknown verdict", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01A", verdict: "maybe" }).success).toBe(false);
  });
  it("rejects a missing or empty testRunId", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", verdict: "confirmed" }).success).toBe(false);
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "", verdict: "confirmed" }).success).toBe(false);
  });
  it("rejects a non-idPattern scenarioId", () => {
    expect(verificationBody.safeParse({ scenarioId: "Bad Id", testRunId: "01A", verdict: "confirmed" }).success).toBe(false);
  });
  it("rejects a summary over 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01A", verdict: "confirmed", summary: big }).success).toBe(false);
  });
  it("drops unknown keys (plain z.object)", () => {
    const parsed = verificationBody.parse({ scenarioId: "s1", testRunId: "01A", verdict: "confirmed", createdAt: "nope" });
    expect("createdAt" in parsed).toBe(false);
  });
});

describe("ideaBody", () => {
  it("accepts a minimal proposed idea", () => {
    expect(ideaBody.safeParse({ title: "Dark mode", status: "proposed", order: 100 }).success).toBe(true);
  });
  it("accepts the optional fields", () => {
    expect(ideaBody.safeParse({ title: "X", rationale: "users asked", status: "accepted", order: 1, originLoopId: "loop-1", builtInLoopId: "loop-2" }).success).toBe(true);
  });
  it("accepts a partial body (all fields optional — required-on-create is the service's job)", () => {
    expect(ideaBody.safeParse({ status: "rejected" }).success).toBe(true);
  });
  it("rejects an unknown status", () => {
    expect(ideaBody.safeParse({ title: "X", status: "maybe", order: 1 }).success).toBe(false);
  });
  it("rejects a non-integer order", () => {
    expect(ideaBody.safeParse({ title: "X", status: "proposed", order: 1.5 }).success).toBe(false);
  });
  it("rejects a non-idPattern originLoopId", () => {
    expect(ideaBody.safeParse({ title: "X", status: "proposed", order: 1, originLoopId: "Bad Id" }).success).toBe(false);
  });
  it("rejects a rationale over 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    expect(ideaBody.safeParse({ title: "X", status: "proposed", order: 1, rationale: big }).success).toBe(false);
  });
  it("drops unknown keys, including a client-supplied by (plain z.object)", () => {
    const parsed = ideaBody.parse({ title: "X", status: "proposed", order: 1, by: "agent", createdAt: "nope" });
    expect("by" in parsed).toBe(false);
    expect("createdAt" in parsed).toBe(false);
  });
});

describe("testRunBody.summary", () => {
  it("accepts an optional summary", () => {
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0, summary: "ran fine" }).success).toBe(true);
  });
  it("rejects a summary over 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0, summary: big }).success).toBe(false);
  });
});
