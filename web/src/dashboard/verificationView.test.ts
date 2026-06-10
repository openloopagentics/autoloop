import { describe, it, expect } from "vitest";
import { verdictForTestRun, scenarioVerification } from "./verificationView";
import type { Verification } from "./types";

const v = (id: string, testRunId: string, verdict: "confirmed" | "refuted", scenarioId = "s1"): Verification =>
  ({ id, scenarioId, testRunId, verdict });

describe("verdictForTestRun", () => {
  it("returns the verdict of the latest (highest-id) verification for that run", () => {
    expect(verdictForTestRun("01A", [v("01V", "01A", "confirmed"), v("01W", "01A", "refuted")])).toBe("refuted");
    expect(verdictForTestRun("01A", [v("01W", "01A", "refuted"), v("01X", "01A", "confirmed")])).toBe("confirmed");
  });
  it("ignores verifications for other runs", () => {
    expect(verdictForTestRun("01A", [v("01V", "01B", "refuted")])).toBeUndefined();
  });
  it("returns undefined when there are none", () => {
    expect(verdictForTestRun("01A", [])).toBeUndefined();
  });
});

describe("scenarioVerification", () => {
  it("resolves the verdict for the scenario's LATEST test-run only", () => {
    // 01B is the latest run; a confirmed verdict on the older 01A does not count
    expect(scenarioVerification("s1", "01B", [v("01V", "01A", "confirmed")])).toBeUndefined();
    expect(scenarioVerification("s1", "01B", [v("01V", "01B", "refuted")])).toBe("refuted");
  });
  it("ignores other scenarios' verifications", () => {
    expect(scenarioVerification("s1", "01A", [v("01V", "01A", "confirmed", "other")])).toBeUndefined();
  });
  it("returns undefined when the scenario has no test-run", () => {
    expect(scenarioVerification("s1", null, [v("01V", "01A", "confirmed")])).toBeUndefined();
  });
});
