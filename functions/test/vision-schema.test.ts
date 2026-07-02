import { describe, it, expect } from "vitest";
// @ts-ignore - untyped .mjs imported for runtime test
import { validateVision, stripForImport } from "../../cli/vision-schema.mjs";

const goodCriterion = { id: "correctness", name: "Correctness", weight: 3, max: 5 };
const goodVision = {
  goals: [{ id: "g1", title: "Sign in", order: 1 }],
  scenarios: [{
    id: "login-works", goalId: "g1", title: "Login succeeds", order: 1, threshold: 80,
    rubric: { criteria: [goodCriterion] }, test: { command: "npm test -- login" },
  }],
  documents: [{ id: "vision", kind: "vision", title: "V", format: "markdown", content: "# V" }],
};

describe("validateVision", () => {
  it("accepts a well-formed vision", () => {
    expect(validateVision(goodVision)).toEqual({ ok: true });
  });
  it("rejects a scenario whose goalId has no matching goal", () => {
    const v = { ...goodVision, scenarios: [{ ...goodVision.scenarios[0], goalId: "ghost" }] };
    const r = validateVision(v);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/goalId 'ghost' has no matching goal/);
  });
  it("rejects bad ids, empty rubric, weight<=0, max<1, threshold>100, bad format", () => {
    expect(validateVision({ goals: [{ id: "Bad Id", title: "x" }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", rubric: { criteria: [] } }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", rubric: { criteria: [{ id: "c", name: "C", weight: 0, max: 5 }] } }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", rubric: { criteria: [{ id: "c", name: "C", weight: 1, max: 0 }] } }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", threshold: 150, rubric: { criteria: [goodCriterion] } }] }).ok).toBe(false);
    expect(validateVision({ documents: [{ id: "d1", kind: "k", title: "t", format: "pdf", content: "x" }] }).ok).toBe(false);
  });
  it("requires a string test.command when test is present", () => {
    const v = { ...goodVision, scenarios: [{ ...goodVision.scenarios[0], test: { command: 5 } }] };
    expect(validateVision(v).ok).toBe(false);
  });
  it("rejects a non-integer order (zod requires int)", () => {
    expect(validateVision({ goals: [{ id: "g1", title: "x", order: 1.5 }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", order: "1", rubric: { criteria: [goodCriterion] } }] }).ok).toBe(false);
  });
  it("treats missing goals/scenarios/documents as empty (valid)", () => {
    expect(validateVision({})).toEqual({ ok: true });
  });
  it("rejects document content over 100KB (matches zod cap)", () => {
    expect(validateVision({ documents: [{ id: "d1", kind: "k", title: "t", format: "markdown", content: "x".repeat(100 * 1024 + 1) }] }).ok).toBe(false);
  });
});

describe("governance (loop-local, optional)", () => {
  const gov = { autonomy: "L2", dailyTokenCap: 500000, earlyExit: true, humanGates: ["payments", "auth"] };
  it("accepts a valid top-level governance block", () => {
    expect(validateVision({ ...goodVision, governance: gov }).ok).toBe(true);
  });
  it("accepts a valid per-scenario governance block", () => {
    const v = { ...goodVision, scenarios: [{ ...goodVision.scenarios[0], governance: gov }] };
    expect(validateVision(v).ok).toBe(true);
  });
  it("rejects bad autonomy, sub-floor cap, non-boolean earlyExit, and empty gate", () => {
    expect(validateVision({ ...goodVision, governance: { autonomy: "L9" } }).ok).toBe(false);
    expect(validateVision({ ...goodVision, governance: { dailyTokenCap: 5000 } }).ok).toBe(false);
    expect(validateVision({ ...goodVision, governance: { earlyExit: "yes" } }).ok).toBe(false);
    expect(validateVision({ ...goodVision, governance: { humanGates: [""] } }).ok).toBe(false);
    expect(validateVision({ ...goodVision, governance: { humanGates: "payments" } }).ok).toBe(false);
  });
  it("reports a per-scenario governance error with its path", () => {
    const v = { ...goodVision, scenarios: [{ ...goodVision.scenarios[0], governance: { autonomy: "X" } }] };
    const r = validateVision(v);
    expect(r.ok).toBe(false);
    expect((r as any).errors.join(" ")).toMatch(/scenarios\[0\].governance.autonomy/);
  });
});

describe("test-harness warnings (non-fatal)", () => {
  it("warns about scenarios with no test.command but stays valid", () => {
    const v = { goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", rubric: { criteria: [goodCriterion] } }] };
    const r = validateVision(v);
    expect(r.ok).toBe(true);
    expect((r as any).warnings?.join(" ")).toMatch(/s1.*no test\.command/);
  });
  it("emits no warnings (exact { ok: true }) when every scenario has a test.command", () => {
    expect(validateVision(goodVision)).toEqual({ ok: true });
  });
});

describe("stripForImport", () => {
  it("drops the loop-local `test` and `governance` fields, keeps the rest", () => {
    const out = stripForImport({ ...goodVision.scenarios[0], governance: { autonomy: "L2" } });
    expect(out.test).toBeUndefined();
    expect((out as any).governance).toBeUndefined();
    expect(out).toMatchObject({ id: "login-works", goalId: "g1", rubric: { criteria: [goodCriterion] } });
  });
});
