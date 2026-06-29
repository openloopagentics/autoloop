import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

// LoopList's per-row containers subscribe to Firestore — stub the hooks so the
// toggle behavior is testable without the SDK.
vi.mock("../hooks", () => {
  const empty = { data: [], loading: false, error: null };
  return { usePhases: () => empty, useScores: () => empty, useTestRuns: () => empty, useVerifications: () => empty };
});

import { LoopsTab } from "../tabs/LoopsTab";
import type { SelectableLoop } from "../loopView";

const loops: SelectableLoop[] = [
  { id: "l2", isMain: false, name: "Loop 2", status: "running", order: 2, previewUrl: "https://l2.web.app" },
  { id: "l1", isMain: false, name: "Loop 1", status: "completed", order: 1, previewUrl: "https://l1.web.app" },
];

// Harness owning the selection like ProjectDetail does (selectedId follows picks).
function Harness() {
  const [picked, setPicked] = useState("l2");
  const selected = loops.find((l) => l.id === picked);
  return (
    <LoopsTab teamId="t" slug="s" loops={loops} scenarios={[]} selectedId={picked} selected={selected}
      onSelect={setPicked} phases={[]} tasks={[]} testRuns={[]} revisions={[]} verifications={[]}
      renderLegacyPhase={() => null} renderTask={() => null} />
  );
}

describe("LoopsTab expand/collapse toggle", () => {
  const detailLink = () => screen.queryByRole("link", { name: /open preview/i });
  const row = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

  it("selected loop starts expanded; clicking it collapses; clicking again re-expands", () => {
    render(<Harness />);
    expect(detailLink()).toHaveAttribute("href", "https://l2.web.app"); // expanded by default
    expect(row("Loop 2")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(row("Loop 2"));
    expect(detailLink()).toBeNull(); // collapsed
    expect(row("Loop 2")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(row("Loop 2"));
    expect(detailLink()).toHaveAttribute("href", "https://l2.web.app"); // re-expanded
  });

  it("clicking a different loop selects and expands it (collapse state resets)", () => {
    render(<Harness />);
    fireEvent.click(row("Loop 2")); // collapse current
    expect(detailLink()).toBeNull();

    fireEvent.click(row("Loop 1")); // switch selection
    expect(detailLink()).toHaveAttribute("href", "https://l1.web.app"); // new loop expanded
    expect(row("Loop 1")).toHaveAttribute("aria-expanded", "true");
    expect(row("Loop 2")).toHaveAttribute("aria-expanded", "false");
  });
});
