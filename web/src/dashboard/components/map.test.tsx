import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GraphEdge, GraphNode } from "../whyGraph";

// MapCanvas is heavy (ReactFlow + dagre) — replace it with a button-per-node stub that also
// exposes the node count so we can assert the reasoning toggle adds nodes.
vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ nodes, edges, onNodeClick }: { nodes: GraphNode[]; edges: GraphEdge[]; onNodeClick?: (id: string) => void }) => (
    <div data-testid="canvas" data-edges={edges.length} data-nodes={nodes.length}>
      {nodes.map((n) => (
        <button key={n.id} type="button" data-state={n.state} data-chip={n.whyChip ?? ""} onClick={() => onNodeClick?.(n.id)}>{n.id}</button>
      ))}
    </div>
  ),
}));

// MapTab calls useDecisions (a Firestore hook) — stub it to an empty result.
vi.mock("../hooks", () => ({
  useDecisions: () => ({ data: [], loading: false, error: null }),
}));

import { MapTab } from "../tabs/MapTab";
import { MapScrubber } from "./MapScrubber";
import type { SelectableLoop } from "../loopView";

const loops: SelectableLoop[] = [
  { id: "l1", isMain: false, name: "Loop 1", status: "completed" },
  { id: "l2", isMain: false, name: "Loop 2", status: "running", currentTaskId: "t2" },
];

function renderTab(overrides: Partial<Parameters<typeof MapTab>[0]> = {}) {
  return render(<MapTab
    teamId="team" slug="proj"
    loops={loops} selectedId="l2" loopArg="l2" onSelect={() => {}}
    goals={[{ id: "g1", title: "Ship auth" }]}
    scenarios={[{ id: "login", goalId: "g1", title: "Login works", threshold: 80 }]}
    scores={[{ id: "01A", scenarioId: "login", composite: 90 }]}
    testRuns={[{ id: "01B", scenarioId: "login", passed: 3, failed: 0 }]}
    tasks={[{ id: "t2", title: "Build login", status: "running", scenarioIds: ["login"] }]}
    bugs={[{ id: "b1", title: "500 on login", status: "open", severity: "low", scenarioId: "login" },
           { id: "bf", title: "Old fixed", status: "fixed" }]}
    currentTaskId="t2"
    verifications={[{ id: "01V", scenarioId: "login", testRunId: "01B", verdict: "confirmed" }]}
    revisions={[{ id: "R1", trigger: { scenarioId: "login", reason: "low score" }, changes: [{ op: "add", taskId: "t2" }] }]}
    projectCreatedAt={1000}
    {...overrides} />);
}

describe("MapTab", () => {
  it("derives graph nodes with correct states and excludes fixed bugs", () => {
    renderTab();
    expect(screen.getByText("scenario:login")).toHaveAttribute("data-state", "met");
    expect(screen.getByText("task:t2")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("bug:b1")).toHaveAttribute("data-state", "bugged"); // high-severity open bug
    expect(screen.queryByText("bug:bf")).toBeNull(); // fixed bug filtered out
  });

  it("keeps the LoopSelector visible", () => {
    renderTab();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("an unmet scenario carries a whyChip on its node", () => {
    renderTab({ scores: [{ id: "01A", scenarioId: "login", composite: 50 }], verifications: [] });
    expect(screen.getByText("scenario:login")).toHaveAttribute("data-chip", expect.stringContaining("50"));
  });

  it("clicking a scenario node opens the why-panel with its reasons; close dismisses it", () => {
    renderTab();
    fireEvent.click(screen.getByText("scenario:login"));
    const panel = screen.getByRole("complementary", { name: /why detail/i });
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Login works" })).toBeInTheDocument();
    expect(screen.getByText(/≥ threshold 80/)).toBeInTheDocument(); // the score reason row
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("toggling 'Show reasoning' increases the rendered node count (decision + evidence appear)", () => {
    renderTab();
    const before = Number(screen.getByTestId("canvas").getAttribute("data-nodes"));
    fireEvent.click(screen.getByRole("button", { name: /show reasoning/i }));
    const after = Number(screen.getByTestId("canvas").getAttribute("data-nodes"));
    expect(after).toBeGreaterThan(before);
  });

  it("shows the empty state when the vision has no goals", () => {
    renderTab({ goals: [] });
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).toBeNull();
  });
});

describe("MapScrubber", () => {
  it("emits a numeric time mid-range and null (live) at max", () => {
    const onChange = vi.fn();
    render(<MapScrubber min={1000} max={5000} value={null} playing={false} onChange={onChange} onPlayPause={() => {}} />);
    const slider = screen.getByRole("slider", { name: /map time/i });
    fireEvent.change(slider, { target: { value: "3000" } });
    expect(onChange).toHaveBeenCalledWith(3000);
    fireEvent.change(slider, { target: { value: "5000" } });
    expect(onChange).toHaveBeenCalledWith(null); // released at max ⇒ live
  });
  it("shows live label when value is null and toggles play/pause", () => {
    const onPlayPause = vi.fn();
    render(<MapScrubber min={0} max={100} value={null} playing={false} onChange={() => {}} onPlayPause={onPlayPause} />);
    expect(screen.getByText(/live/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(onPlayPause).toHaveBeenCalled();
  });
});

describe("MapTab replay mode", () => {
  it("scrubbing before a task's createdAt drops it from the graph (full reasoning replay)", () => {
    renderTab({
      tasks: [{ id: "t2", title: "Build login", status: "running", scenarioIds: ["login"], createdAt: 4000 }],
      projectCreatedAt: 1000,
    });
    expect(screen.getByText("task:t2")).toBeInTheDocument(); // live first
    fireEvent.change(screen.getByRole("slider", { name: /map time/i }), { target: { value: "2000" } });
    expect(screen.queryByText("task:t2")).toBeNull();        // not yet created at T=2000
    expect(screen.getByText("scenario:login")).toBeInTheDocument();
  });
});
