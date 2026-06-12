import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestRunsSection } from "./TestRunsSection";
import { LoopRow } from "./LoopRow";
import { LoopDetail } from "./LoopDetail";
import type { SelectableLoop } from "../loopView";

describe("TestRunsSection", () => {
  it("renders counts and a summary when present, nothing when empty", () => {
    const { container, rerender } = render(<TestRunsSection testRuns={[{ id: "01A", passed: 8, failed: 1, summary: "exercised login" }]} />);
    expect(screen.getByText(/8 passed/)).toBeInTheDocument();
    expect(screen.getByText(/exercised login/)).toBeInTheDocument();
    rerender(<TestRunsSection testRuns={[]} />);
    expect(container.firstChild).toBeNull();
  });
  it("shows ✓ Verified / ✗ Refuted per the latest verification, nothing when unverified", () => {
    const runs = [{ id: "01A", passed: 8, failed: 0 }];
    const { rerender } = render(<TestRunsSection testRuns={runs}
      verifications={[{ id: "01V", testRunId: "01A", verdict: "confirmed" }]} />);
    expect(screen.getByText("✓ Verified")).toBeInTheDocument();
    rerender(<TestRunsSection testRuns={runs}
      verifications={[{ id: "01V", testRunId: "01A", verdict: "confirmed" }, { id: "01W", testRunId: "01A", verdict: "refuted" }]} />);
    expect(screen.getByText("✗ Refuted")).toBeInTheDocument(); // latest (01W) wins
    rerender(<TestRunsSection testRuns={runs} verifications={[]} />);
    expect(screen.queryByText(/Verified|Refuted/)).toBeNull(); // nothing when unverified
  });
});

describe("LoopDetail preview link", () => {
  const noop = () => null;
  it("renders the preview anchor when previewUrl is set, hides it otherwise", () => {
    const { rerender } = render(
      <LoopDetail phases={[]} tasks={[]} testRuns={[]} revisions={[]} previewUrl="https://app--l1.web.app"
        renderLegacyPhase={noop} renderTask={noop} />);
    expect(screen.getByRole("link", { name: /open preview/i })).toHaveAttribute("rel", "noopener noreferrer");
    rerender(
      <LoopDetail phases={[]} tasks={[]} testRuns={[]} revisions={[]}
        renderLegacyPhase={noop} renderTask={noop} />);
    expect(screen.queryByRole("link", { name: /open preview/i })).toBeNull();
  });
});

describe("LoopRow", () => {
  const loop: SelectableLoop = { id: "l2", isMain: false, name: "Payments", status: "running" };
  it("shows name, marks running, shows progress + met, fires onSelect", () => {
    const onSelect = vi.fn();
    render(<LoopRow loop={loop} selected={false} progress={{ done: 2, total: 5 }} met={{ met: 1, total: 3 }} onSelect={onSelect} />);
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument(); // StatusBadge text
    expect(screen.getByText(/2\/5/)).toBeInTheDocument();
    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("l2");
  });
  it("shows the iteration number when order is set; never on main", () => {
    render(<LoopRow loop={{ ...loop, order: 7 }} selected={false} progress={{ done: 0, total: 0 }} met={{ met: 0, total: 0 }} onSelect={() => {}} />);
    expect(screen.getByTitle("iteration 7")).toHaveTextContent("#7");
    const { container } = render(<LoopRow loop={{ id: "main", isMain: true, name: "main" }} selected={false} progress={{ done: 0, total: 0 }} met={{ met: 0, total: 0 }} onSelect={() => {}} />);
    expect(container.querySelector(".looprow-iter")).toBeNull();
  });
});
