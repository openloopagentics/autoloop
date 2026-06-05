import { describe, it, expect } from "vitest";
import { basePath, buildLoopList, defaultSelectedLoop, phaseProgress, loopIsRunning } from "./loopView";
import type { Loop, Phase, Project } from "./types";

describe("basePath", () => {
  it("is project-direct without a loopId", () => {
    expect(basePath("t", "web")).toEqual(["teams", "t", "projects", "web"]);
  });
  it("inserts loops/<id> with a loopId", () => {
    expect(basePath("t", "web", "l1")).toEqual(["teams", "t", "projects", "web", "loops", "l1"]);
  });
});

describe("buildLoopList", () => {
  const project = { slug: "web", status: "running", currentPhaseId: "p1", currentTaskId: "t1" } as Project;
  const loops: Loop[] = [
    { id: "l2", goal: "B", order: 2, status: "running", currentTaskId: "t9" },
    { id: "l1", goal: "A", order: 1, status: "completed" },
  ];
  it("sorts explicit loops latest-first (descending by order) and adds no main when no legacy data", () => {
    const list = buildLoopList(loops, project, false);
    expect(list.map((l) => l.id)).toEqual(["l2", "l1"]);
    expect(list.some((l) => l.isMain)).toBe(false);
  });
  it("appends a synthesized main (with project fields) when legacy data exists", () => {
    const list = buildLoopList(loops, project, true);
    expect(list[list.length - 1]).toMatchObject({ id: "main", isMain: true, status: "running", currentTaskId: "t1" });
  });
  it("main-only when there are no explicit loops", () => {
    const list = buildLoopList([], project, true);
    expect(list).toHaveLength(1);
    expect(list[0].isMain).toBe(true);
  });
});

describe("defaultSelectedLoop", () => {
  const list = buildLoopList(
    [{ id: "l1", order: 1, status: "completed" }, { id: "l2", order: 2, status: "running" }],
    { slug: "web", status: "running", currentPhaseId: "p" } as Project, true);
  it("prefers a valid currentLoopId", () => {
    expect(defaultSelectedLoop(list, "l1")).toBe("l1");
  });
  it("falls back to the most-recent explicit loop (highest order)", () => {
    expect(defaultSelectedLoop(list, null)).toBe("l2");
  });
  it("falls back to main when only main exists", () => {
    const mainOnly = buildLoopList([], { slug: "web", currentPhaseId: "p" } as Project, true);
    expect(defaultSelectedLoop(mainOnly, null)).toBe("main");
  });
  it("returns '' for an empty list", () => {
    expect(defaultSelectedLoop([], null)).toBe("");
  });
});

describe("phaseProgress", () => {
  const phases: Phase[] = [
    { id: "p1", status: "completed" }, { id: "p2", status: "failed" },
    { id: "p3", status: "running" }, { id: "p4", status: "queued" }, { id: "p5", status: "cancelled" },
  ];
  it("counts terminal phases (completed/failed/cancelled) as done", () => {
    expect(phaseProgress(phases)).toEqual({ done: 3, total: 5 });
  });
  it("handles no phases", () => {
    expect(phaseProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("loopIsRunning", () => {
  it("is true only for status running", () => {
    expect(loopIsRunning({ status: "running" })).toBe(true);
    expect(loopIsRunning({ status: "completed" })).toBe(false);
    expect(loopIsRunning({})).toBe(false);
  });
});
