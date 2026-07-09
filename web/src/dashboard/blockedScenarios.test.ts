import { describe, it, expect } from "vitest";
import { blockedScenarioIds } from "./blockedScenarios";
import type { Page, PageComment } from "./types";

const comment = (over: Partial<PageComment> = {}): PageComment => ({ id: "c1", severity: "blocking", status: "open", ...over });
const page = (over: Partial<Page> = {}): Page => ({ id: "p1", ...over });

describe("blockedScenarioIds", () => {
  it("open blocking + targetScenarioId → blocked", () => {
    const out = blockedScenarioIds([comment({ targetScenarioId: "s1" })], []);
    expect(out.has("s1")).toBe(true);
  });

  it("resolved-but-unaccepted → still blocked", () => {
    const out = blockedScenarioIds([comment({ targetScenarioId: "s1", status: "resolved", accepted: false })], []);
    expect(out.has("s1")).toBe(true);
  });

  it("open + accepted:true → still blocked (acceptance alone doesn't unblock)", () => {
    const out = blockedScenarioIds([comment({ targetScenarioId: "s1", status: "open", accepted: true })], []);
    expect(out.has("s1")).toBe(true);
  });

  it("resolved + accepted → unblocked", () => {
    const out = blockedScenarioIds([comment({ targetScenarioId: "s1", status: "resolved", accepted: true })], []);
    expect(out.has("s1")).toBe(false);
  });

  it("declined + accepted → unblocked", () => {
    const out = blockedScenarioIds([comment({ targetScenarioId: "s1", status: "declined", accepted: true })], []);
    expect(out.has("s1")).toBe(false);
  });

  it("advisory → never blocked", () => {
    const out = blockedScenarioIds([comment({ targetScenarioId: "s1", severity: "advisory" })], []);
    expect(out.has("s1")).toBe(false);
  });

  it("page-wide (no targetScenarioId) → blocks all scenarioIds of that page", () => {
    const out = blockedScenarioIds(
      [comment({ pageId: "p1" })],
      [page({ id: "p1", scenarioIds: ["s1", "s2"] })],
    );
    expect(out.has("s1")).toBe(true);
    expect(out.has("s2")).toBe(true);
  });

  it("comment whose pageId matches no page (deleted page) and no target → blocks nothing", () => {
    const out = blockedScenarioIds([comment({ pageId: "gone" })], [page({ id: "p1", scenarioIds: ["s1"] })]);
    expect(out.size).toBe(0);
  });
});
