import { describe, it, expect } from "vitest";
import { buildMap, hueForLoop } from "./mapView";
import type { Bug, Goal, Scenario, Task } from "./types";

const goals: Goal[] = [{ id: "g1", title: "Ship auth" }];
const scenarios: Scenario[] = [
  { id: "login", goalId: "g1", title: "Login works" },
  { id: "logout", goalId: "g1", title: "Logout works" },
  { id: "orphan", goalId: "ghost", title: "Dangling goal ref" },
];
const states = {
  login: { state: "met" as const, latestComposite: 90, latestTest: null },
  logout: { state: "unmet" as const, latestComposite: null, latestTest: null },
  orphan: { state: "unmet" as const, latestComposite: null, latestTest: null },
};
const tasks: Task[] = [
  { id: "t1", title: "Build login", status: "completed", scenarioIds: ["login"] },
  { id: "t2", title: "Build logout", status: "running", scenarioIds: ["logout", "ghost-scn"] },
];
const bugs: Bug[] = [
  { id: "b1", title: "500 on login", status: "open", severity: "high", scenarioId: "login", taskId: "t1" },
  { id: "b2", title: "Slow logout", status: "open", severity: "low", scenarioId: "logout" }, // no taskId → scenario fallback
  { id: "b3", title: "Orphan bug", status: "open" }, // no refs → node, no edge
];

function graph(overrides: Partial<Parameters<typeof buildMap>[0]> = {}) {
  return buildMap({ goals, scenarios, scenarioStates: states, tasks, currentTaskId: "t2", openBugs: bugs, ...overrides });
}
const byId = (g: ReturnType<typeof buildMap>, id: string) => g.nodes.find((n) => n.id === id);

describe("buildMap nodes", () => {
  it("namespaces ids and types every entity", () => {
    const g = graph();
    expect(byId(g, "g:g1")?.type).toBe("goal");
    expect(byId(g, "s:login")?.type).toBe("scenario");
    expect(byId(g, "t:t1")?.type).toBe("task");
    expect(byId(g, "b:b1")?.type).toBe("bug");
  });
  it("goals are neutral; scenarios carry met/unmet from scenarioStates", () => {
    const g = graph();
    expect(byId(g, "g:g1")?.state).toBe("neutral");
    expect(byId(g, "s:logout")?.state).toBe("unmet");
  });
  it("an open HIGH bug overrides a met scenario to bugged", () => {
    expect(byId(graph(), "s:login")?.state).toBe("bugged"); // met, but b1 is open+high
  });
  it("a low-severity open bug does NOT override the scenario state", () => {
    expect(byId(graph(), "s:logout")?.state).toBe("unmet"); // b2 is low
  });
  it("the current task is active; others neutral; terminal tasks get done:true", () => {
    const g = graph();
    expect(byId(g, "t:t2")?.state).toBe("active");
    expect(byId(g, "t:t1")?.state).toBe("neutral");
    expect(byId(g, "t:t1")?.done).toBe(true);
    expect(byId(g, "t:t2")?.done).toBeUndefined();
  });
  it("open bugs are bugged nodes; labels fall back to ids", () => {
    const g = buildMap({ goals: [{ id: "g1" }], scenarios: [], scenarioStates: {}, tasks: [], currentTaskId: null, openBugs: [{ id: "b9", status: "open" }] });
    expect(byId(g, "b:b9")?.state).toBe("bugged");
    expect(byId(g, "b:b9")?.label).toBe("b9");
    expect(byId(g, "g:g1")?.label).toBe("g1");
  });
});

describe("buildMap edges", () => {
  const has = (g: ReturnType<typeof buildMap>, from: string, to: string) =>
    g.edges.some((e) => e.from === from && e.to === to);
  it("builds goal→scenario, scenario→task, task→bug", () => {
    const g = graph();
    expect(has(g, "g:g1", "s:login")).toBe(true);
    expect(has(g, "s:login", "t:t1")).toBe(true);
    expect(has(g, "t:t1", "b:b1")).toBe(true);
  });
  it("falls back to scenario→bug when the bug has no taskId", () => {
    expect(has(graph(), "s:logout", "b:b2")).toBe(true);
  });
  it("falls back to scenario→bug when the bug's task is not on the map", () => {
    const g = graph({ tasks: [] }); // b1 has taskId t1, but no task nodes
    expect(has(g, "s:login", "b:b1")).toBe(true);
  });
  it("drops dangling edges (missing goal, missing scenario, refless bug)", () => {
    const g = graph();
    expect(g.edges.some((e) => e.from === "g:ghost")).toBe(false);      // orphan scenario's goal
    expect(g.edges.some((e) => e.from === "s:ghost-scn")).toBe(false);  // t2's ghost scenario
    expect(g.edges.some((e) => e.to === "b:b3")).toBe(false);           // refless bug: node only
    expect(byId(g, "b:b3")).toBeDefined();
  });
});

describe("hueForLoop", () => {
  it("is deterministic and in [0, 360)", () => {
    expect(hueForLoop("loop-2026-06-09")).toBe(hueForLoop("loop-2026-06-09"));
    expect(hueForLoop("l1")).toBeGreaterThanOrEqual(0);
    expect(hueForLoop("l1")).toBeLessThan(360);
  });
  it("differs for different loop ids", () => {
    expect(hueForLoop("l1")).not.toBe(hueForLoop("l2"));
  });
});
