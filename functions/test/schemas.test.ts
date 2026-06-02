import { describe, it, expect } from "vitest";
import { idPattern, projectBody, phaseBody, commitBody } from "../src/schemas.js";

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
