import { describe, it, expect } from "vitest";
import { buildTrend, trendWindow, polylinePoints, MAIN_TREND_ORDER, TREND_LOOPS_MAX, type LoopRunData } from "./trendView";
import type { Loop, Scenario } from "./types";

const scenarios = [
  { id: "s1", threshold: 80 },
  { id: "s2", threshold: 80 },
  { id: "s3", threshold: 80 },
] as Scenario[];

function runData(over: Partial<LoopRunData> & { loop: Loop }): LoopRunData {
  return { scores: [], testRuns: [], bugs: [], taskCommits: [], tasks: [], verifications: [], ...over };
}

describe("buildTrend", () => {
  it("counts met via scenarioStatus over THIS loop's events only (latest by id)", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      tasks: [{ id: "t1", scenarioIds: ["s1", "s2"] }],
      scores: [
        { id: "01A", scenarioId: "s1", composite: 90 },  // older
        { id: "01B", scenarioId: "s1", composite: 70 },  // latest s1 → below threshold
        { id: "01C", scenarioId: "s2", composite: 85 },  // latest s2 → met (test passes)
      ],
      testRuns: [
        { id: "01D", scenarioId: "s1", passed: 1, failed: 0 },
        { id: "01E", scenarioId: "s2", passed: 2, failed: 0 },
      ],
    });
    const [p] = buildTrend([d], scenarios);
    expect(p.metCount).toBe(1);          // only s2: s1's LATEST composite (70) is below threshold
    expect(p.scenarioTotal).toBe(2);     // s3 not tagged in this loop's tasks
    expect(p.avgComposite).toBe(77.5);   // mean of latest composites: (70 + 85) / 2
  });

  it("met requires BOTH a passing latest test-run and composite >= threshold in the loop", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      tasks: [{ id: "t1", scenarioIds: ["s1"] }],
      scores: [{ id: "01A", scenarioId: "s1", composite: 95 }],
      testRuns: [{ id: "01B", scenarioId: "s1", passed: 3, failed: 1 }], // failing → unmet
    });
    expect(buildTrend([d], scenarios)[0].metCount).toBe(0);
  });

  it("scenarioTotal is the union of tasks[].scenarioIds (deduped, only existing scenarios)", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      tasks: [
        { id: "t1", scenarioIds: ["s1", "s2"] },
        { id: "t2", scenarioIds: ["s2", "ghost"] }, // dupe + unknown id
        { id: "t3" },                               // no scenarioIds
      ],
    });
    expect(buildTrend([d], scenarios)[0].scenarioTotal).toBe(2);
  });

  it("avgComposite is null when no tagged scenario has a score", () => {
    const d = runData({ loop: { id: "l1", order: 1 }, tasks: [{ id: "t1", scenarioIds: ["s1"] }] });
    expect(buildTrend([d], scenarios)[0].avgComposite).toBeNull();
  });

  it("bugsOpened counts all bugs in the loop; bugsFixed counts status=fixed", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      bugs: [{ id: "b1", status: "open" }, { id: "b2", status: "fixed" }, { id: "b3", status: "fixed" }],
    });
    const [p] = buildTrend([d], scenarios);
    expect(p.bugsOpened).toBe(3);
    expect(p.bugsFixed).toBe(2);
  });

  it("tokensTotal sums taskCommit.tokens.total, missing tokens ⇒ 0", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      taskCommits: [
        { sha: "a", tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 1000 } },
        { sha: "b" }, // legacy commit without tokens
        { sha: "c", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 250 } },
      ],
    });
    expect(buildTrend([d], scenarios)[0].tokensTotal).toBe(1250);
  });

  it("orders ascending by loop.order with the orderless main FIRST (MAIN_TREND_ORDER)", () => {
    const points = buildTrend([
      runData({ loop: { id: "l2", order: 2 } }),
      runData({ loop: { id: "main" } }),            // synthesized: no order
      runData({ loop: { id: "l1", order: 1 } }),
    ], scenarios);
    expect(points.map((p) => p.loopId)).toEqual(["main", "l1", "l2"]);
    expect(points[0].order).toBe(MAIN_TREND_ORDER);
  });

  it("refuted-but-high scenario counts as unmet in metCount", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      tasks: [{ id: "t1", scenarioIds: ["s1"] }],
      scores: [{ id: "01A", scenarioId: "s1", composite: 95 }],
      testRuns: [{ id: "01B", scenarioId: "s1", passed: 3, failed: 0 }],
      verifications: [{ id: "01V", scenarioId: "s1", verdict: "refuted" }],
    });
    expect(buildTrend([d], scenarios)[0].metCount).toBe(0);
  });
});

describe("trendWindow", () => {
  const mkLoops = (n: number): Loop[] => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, order: i + 1 }));
  it("prepends main when includeMain and keeps ascending order", () => {
    expect(trendWindow(mkLoops(2), true).map((l) => l.id)).toEqual(["main", "l1", "l2"]);
    expect(trendWindow(mkLoops(2), false).map((l) => l.id)).toEqual(["l1", "l2"]);
  });
  it("caps at TREND_LOOPS_MAX keeping the MOST RECENT loops (main falls out first)", () => {
    const w = trendWindow(mkLoops(25), true);
    expect(w).toHaveLength(TREND_LOOPS_MAX);
    expect(w[0].id).toBe("l6");                  // main + l1..l5 dropped
    expect(w[w.length - 1].id).toBe("l25");
  });
});

describe("polylinePoints", () => {
  it("maps a series into pad-inset svg coordinates, min at bottom, max at top", () => {
    const pts = polylinePoints([0, 10], 100, 40); // pad = 2
    expect(pts).toBe("2.0,38.0 98.0,2.0");
  });
  it("renders a flat series at mid-height", () => {
    expect(polylinePoints([5, 5, 5], 100, 40)).toBe("2.0,20.0 50.0,20.0 98.0,20.0");
  });
  it("skips nulls (gap points dropped, x positions preserved)", () => {
    expect(polylinePoints([0, null, 10], 100, 40)).toBe("2.0,38.0 98.0,2.0");
  });
  it("is empty for an all-null or empty series", () => {
    expect(polylinePoints([], 100, 40)).toBe("");
    expect(polylinePoints([null, null], 100, 40)).toBe("");
  });
});
