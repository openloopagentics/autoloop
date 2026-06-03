import { describe, it, expect } from "vitest";
import { deriveState, decideScenarioNotification, allMet } from "../src/notify/decide.js";

const scn = (over = {}) => ({ id: "s1", threshold: 80, ...over });
const score = (id: string, composite: number, scenarioId = "s1") => ({ id, scenarioId, composite });
const run = (id: string, failed: number, scenarioId = "s1") => ({ id, scenarioId, failed });

describe("deriveState", () => {
  it("met when latest composite>=threshold and latest failed==0", () => {
    expect(deriveState(scn(), [score("01A", 85)], [run("01A", 0)])).toBe("met");
  });
  it("unmet below threshold or with failures or missing data", () => {
    expect(deriveState(scn(), [score("01A", 70)], [run("01A", 0)])).toBe("unmet");
    expect(deriveState(scn(), [score("01A", 95)], [run("01A", 1)])).toBe("unmet");
    expect(deriveState(scn(), [], [run("01A", 0)])).toBe("unmet");
    expect(deriveState(scn(), [score("01A", 95)], [])).toBe("unmet");
  });
  it("default threshold 80", () => {
    expect(deriveState(scn({ threshold: undefined }), [score("01A", 80)], [run("01A", 0)])).toBe("met");
  });
});

describe("decideScenarioNotification", () => {
  const S = [score("01A", 90)], R = [run("01A", 0)];
  it("first-write met → notify scenario_met", () => {
    expect(decideScenarioNotification(scn(), S, R, undefined)).toEqual({ newState: "met", type: "scenario_met" });
  });
  it("first-write unmet → silent", () => {
    expect(decideScenarioNotification(scn(), [score("01A", 10)], R, undefined)).toEqual({ newState: "unmet" });
  });
  it("met→unmet flip → scenario_unmet", () => {
    expect(decideScenarioNotification(scn(), [score("01A", 10)], R, "met")).toEqual({ newState: "unmet", type: "scenario_unmet" });
  });
  it("unmet→met flip → scenario_met", () => {
    expect(decideScenarioNotification(scn(), S, R, "unmet")).toEqual({ newState: "met", type: "scenario_met" });
  });
  it("no flip → no type", () => {
    expect(decideScenarioNotification(scn(), S, R, "met")).toEqual({ newState: "met" });
  });
});

describe("allMet", () => {
  it("true iff >=1 scenario and all met", () => {
    expect(allMet([{ id: "s1" }], { s1: [score("01A", 90, "s1")] }, { s1: [run("01A", 0, "s1")] })).toBe(true);
    expect(allMet([], {}, {})).toBe(false);
    expect(allMet([{ id: "s1" }, { id: "s2" }], { s1: [score("01A", 90, "s1")], s2: [score("01A", 10, "s2")] }, { s1: [run("01A", 0, "s1")], s2: [run("01A", 0, "s2")] })).toBe(false);
  });
});
