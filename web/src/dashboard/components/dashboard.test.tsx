import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RollupStrip } from "./RollupStrip";
import { LoopSnapshot } from "./LoopSnapshot";
import type { SelectableLoop } from "../loopView";

const loops: SelectableLoop[] = [
  { id: "l1", isMain: false, status: "completed" },
  { id: "l2", isMain: false, status: "running" },
  { id: "l3", isMain: false, status: "running" },
];

describe("RollupStrip", () => {
  it("shows total loops and running count", () => {
    render(<RollupStrip loops={loops} status="running" />);
    expect(screen.getByText("3")).toBeInTheDocument();   // total
    expect(screen.getByText("2")).toBeInTheDocument();   // running
  });
});

describe("LoopSnapshot", () => {
  const loop: SelectableLoop = { id: "l2", isMain: false, name: "Payments", status: "running", currentTaskId: "t2" };
  const scenarios = [{ id: "s1", threshold: 80 }, { id: "s2", threshold: 80 }] as any;
  const scores = [{ id: "01A", scenarioId: "s1", composite: 90 }] as any;
  const testRuns = [{ id: "01B", scenarioId: "s1", passed: 1, failed: 0 }] as any;
  const phases = [{ id: "p1", status: "completed" }, { id: "p2", status: "running" }] as any;
  const tasks = [{ id: "t2", title: "Wire Stripe", status: "running" }] as any;
  it("shows phases done/total, N/M met, and the in-progress task", () => {
    const { container } = render(<LoopSnapshot loop={loop} phases={phases} tasks={tasks} scenarios={scenarios} scores={scores} testRuns={testRuns} />);
    // both metrics are "1/2" here, so query by class (not getByText, which would throw on the duplicate)
    expect(container.querySelector(".snapshot-phases")?.textContent).toContain("1/2"); // phases done/total
    expect(container.querySelector(".snapshot-met")?.textContent).toContain("1/2");    // N/M met
    expect(screen.getByText(/Wire Stripe/)).toBeInTheDocument();                        // in-progress task
  });
  it("says no active task when currentTaskId is absent", () => {
    render(<LoopSnapshot loop={{ id: "l1", isMain: false }} phases={[]} tasks={[]} scenarios={[]} scores={[]} testRuns={[]} />);
    expect(screen.getByText(/no active task/i)).toBeInTheDocument();
  });
});
