import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MapEdge, MapNode } from "../mapView";

vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ nodes, edges, onNodeClick }: { nodes: MapNode[]; edges: MapEdge[]; onNodeClick?: (id: string) => void }) => (
    <div data-testid="canvas" data-edges={edges.length}>
      {nodes.map((n) => (
        <button key={n.id} type="button" data-state={n.state} onClick={() => onNodeClick?.(n.id)}>{n.id}</button>
      ))}
    </div>
  ),
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
    loops={loops} selectedId="l2" onSelect={() => {}}
    goals={[{ id: "g1", title: "Ship auth" }]}
    scenarios={[{ id: "login", goalId: "g1", title: "Login works", threshold: 80 }]}
    scores={[{ id: "01A", scenarioId: "login", composite: 90 }]}
    testRuns={[{ id: "01B", scenarioId: "login", passed: 3, failed: 0 }]}
    tasks={[{ id: "t2", title: "Build login", status: "running", scenarioIds: ["login"] }]}
    bugs={[{ id: "b1", title: "500 on login", status: "open", severity: "low", scenarioId: "login" },
           { id: "bf", title: "Old fixed", status: "fixed" }]}
    currentTaskId="t2"
    verifications={[{ id: "01V", scenarioId: "login", testRunId: "01B", verdict: "confirmed" }]}
    {...overrides} />);
}

describe("MapTab", () => {
  it("derives nodes with correct states and excludes fixed bugs", () => {
    renderTab();
    expect(screen.getByText("s:login")).toHaveAttribute("data-state", "met");
    expect(screen.getByText("t:t2")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("b:b1")).toHaveAttribute("data-state", "bugged");
    expect(screen.queryByText("b:bf")).toBeNull(); // fixed bug filtered out
  });
  it("keeps the LoopSelector visible", () => {
    renderTab();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
  it("clicking a scenario node opens a ScenarioCard side panel; close dismisses it", () => {
    renderTab();
    fireEvent.click(screen.getByText("s:login"));
    const panel = screen.getByRole("complementary", { name: /map detail/i });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Login works")).toBeInTheDocument(); // ScenarioCard title
    expect(screen.getByTitle("Independently verified")).toBeInTheDocument(); // verification badge threads through
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("clicking task / bug / goal nodes shows TaskItem / BugItem / goal card", () => {
    renderTab();
    fireEvent.click(screen.getByText("t:t2"));
    expect(screen.getByText("Build login")).toBeInTheDocument();   // TaskItem
    fireEvent.click(screen.getByText("b:b1"));
    expect(screen.getByText("500 on login")).toBeInTheDocument();  // BugItem
    fireEvent.click(screen.getByText("g:g1"));
    expect(screen.getByText("Ship auth")).toBeInTheDocument();     // goal card
  });
  it("shows the empty state when the vision has no goals", () => {
    renderTab({ goals: [] });
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).toBeNull();
  });
});

describe("MapTab product-map layer", () => {
  it("renders component nodes and a label card on click", () => {
    renderTab({ productMap: JSON.stringify({ nodes: [{ id: "api", label: "REST API", scenarioIds: ["login"] }] }) });
    fireEvent.click(screen.getByText("c:api"));
    expect(screen.getByText("REST API")).toBeInTheDocument();
  });
  it("shows a warning card (not a crash) on malformed content, and still renders the base graph", () => {
    renderTab({ productMap: "{broken" });
    expect(screen.getByRole("note")).toHaveTextContent(/not valid JSON/i);
    expect(screen.getByText("s:login")).toBeInTheDocument();
  });
  it("shows no warning card without a product map", () => {
    renderTab();
    expect(screen.queryByRole("note")).toBeNull();
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
  const slices = [{
    loopId: "l2",
    tasks: [{ id: "t2", title: "Build login", status: "running", scenarioIds: ["login"], createdAt: 4000 }],
    bugs: [], scores: [], testRuns: [],
  }];
  it("renders mapAtTime(T) while scrubbed: a task created after T disappears", () => {
    renderTab({ slices, projectCreatedAt: 1000 });
    expect(screen.getByText("t:t2")).toBeInTheDocument(); // live mode first
    fireEvent.change(screen.getByRole("slider", { name: /map time/i }), { target: { value: "2000" } });
    expect(screen.queryByText(/t2/)).toBeNull();          // not yet created at T=2000
    expect(screen.getByText("s:login")).toBeInTheDocument();
  });
  it("hides the scrubber when no slices are provided (Phase 1 behavior unchanged)", () => {
    renderTab();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
