import { describe, it, expect } from "vitest";
import { basePath, buildLoopList, defaultSelectedLoop, displayLoopStatus, effectiveProjectStatus, groupLoopRuns, phaseProgress, loopIsRunning, STALE_RUNNING_MS } from "./loopView";
import type { Loop, Phase, Project } from "./types";

describe("basePath", () => {
  it("is project-direct without a loopId", () => {
    expect(basePath("t", "web")).toEqual(["teams", "t", "projects", "web"]);
  });
  it("inserts loops/<id> with a loopId", () => {
    expect(basePath("t", "web", "l1")).toEqual(["teams", "t", "projects", "web", "loops", "l1"]);
  });
});

describe("displayLoopStatus (zombie rule)", () => {
  const NOW = 10 * STALE_RUNNING_MS;
  it("running + fresh updatedAt stays running", () => {
    expect(displayLoopStatus({ status: "running", updatedAt: NOW - 60_000 }, NOW)).toBe("running");
  });
  it("running but untouched for 3+ hours renders as paused", () => {
    expect(displayLoopStatus({ status: "running", updatedAt: NOW - STALE_RUNNING_MS - 1 }, NOW)).toBe("paused");
  });
  it("falls back to startedAt when updatedAt is missing", () => {
    expect(displayLoopStatus({ status: "running", startedAt: NOW - STALE_RUNNING_MS - 1 }, NOW)).toBe("paused");
    expect(displayLoopStatus({ status: "running", startedAt: NOW - 60_000 }, NOW)).toBe("running");
  });
  it("non-running statuses and timeless running pass through untouched", () => {
    expect(displayLoopStatus({ status: "completed", updatedAt: 0 }, NOW)).toBe("completed");
    expect(displayLoopStatus({ status: "running" }, NOW)).toBe("running"); // no timestamps → benefit of the doubt
  });
  it("buildLoopList maps a zombie to paused; loopIsRunning and effectiveProjectStatus ignore zombies", () => {
    const zombie = { id: "z", status: "running", updatedAt: NOW - STALE_RUNNING_MS - 1, order: 1 };
    const list = buildLoopList([zombie], { slug: "web" } as Project, false, NOW);
    expect(list[0].status).toBe("paused");
    expect(loopIsRunning(list[0])).toBe(false);
    expect(effectiveProjectStatus([zombie], "running", NOW)).toBe("paused");
  });
});

describe("groupLoopRuns", () => {
  const NOW = new Date("2026-06-11T12:00:00").getTime();
  const sl = (id: string, startedAt?: number, isMain = false) =>
    ({ id, isMain, startedAt }) as Parameters<typeof groupLoopRuns>[0][number];
  it("groups newest-first iterations under Today/Yesterday/date runs; main → legacy; no-time → earlier", () => {
    const groups = groupLoopRuns([
      sl("t2", NOW - 2 * 3600_000),                    // today
      sl("t7", NOW - 7 * 3600_000),                    // today
      sl("y1", NOW - 26 * 3600_000),                   // yesterday
      sl("old", new Date("2026-06-01T10:00:00").getTime()),
      sl("untimed", undefined),
      sl("main", undefined, true),
    ], NOW);
    expect(groups.map((g) => g.label)).toEqual([
      "Today", "Yesterday",
      new Date("2026-06-01T10:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      "earlier", "legacy",
    ]);
    expect(groups[0].loops.map((l) => l.id)).toEqual(["t2", "t7"]); // input order preserved (newest first)
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
  it("passes previewUrl through to the selectable loop; synthesized main has none", () => {
    const list = buildLoopList(
      [{ id: "l1", order: 1, status: "completed", previewUrl: "https://p.web.app" }], project, true);
    expect(list.find((l) => l.id === "l1")?.previewUrl).toBe("https://p.web.app");
    expect(list.find((l) => l.isMain)?.previewUrl).toBeUndefined();
  });
  it("sorts by startedAt desc ahead of order; numeric-aware id desc as the last tie-break", () => {
    const tied: Loop[] = [
      { id: "loop-2026-06-10-9", order: 5 },
      { id: "loop-2026-06-10-10", order: 5 },
    ];
    expect(buildLoopList(tied, project, false).map((l) => l.id))
      .toEqual(["loop-2026-06-10-10", "loop-2026-06-10-9"]);
    // startedAt (server truth) beats a stale agent-supplied order
    const byStart: Loop[] = [
      { id: "old-high-order", order: 9, startedAt: 1000 },
      { id: "new-low-order", order: 1, startedAt: 2000 },
    ];
    expect(buildLoopList(byStart, project, false).map((l) => l.id)).toEqual(["new-low-order", "old-high-order"]);
  });
  it("a stale loop stuck running does NOT outrank newer iterations (strict time order)", () => {
    const ls: Loop[] = [
      { id: "zombie-running", order: 1, status: "running", startedAt: 1000 },
      { id: "newer-done", order: 9, status: "completed", startedAt: 9000 },
    ];
    const list = buildLoopList(ls, project, false);
    expect(list.map((l) => l.id)).toEqual(["newer-done", "zombie-running"]);
    expect(list[1].startedAt).toBe(1000); // startedAt passes through
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
