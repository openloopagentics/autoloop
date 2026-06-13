import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendsStrip } from "./TrendsStrip";
import type { TrendPoint } from "../trendView";

const pt = (i: number, over: Partial<TrendPoint> = {}): TrendPoint => ({
  loopId: `l${i}`, order: i, metCount: i, scenarioTotal: 4, avgComposite: 70 + i,
  bugsOpened: 2, bugsFixed: 1, tokensTotal: 100000 * i, ...over,
});

describe("TrendsStrip", () => {
  it("renders nothing with fewer than 2 points (no trend from one point)", () => {
    expect(render(<TrendsStrip points={[]} />).container.firstChild).toBeNull();
    expect(render(<TrendsStrip points={[pt(1)]} />).container.firstChild).toBeNull();
  });

  it("renders the 4 labeled sparklines (5 polylines: bugs has two strokes)", () => {
    const { container } = render(<TrendsStrip points={[pt(1), pt(2), pt(3)]} />);
    expect(container.querySelectorAll("svg")).toHaveLength(4);
    expect(container.querySelectorAll("polyline")).toHaveLength(5);
    expect(screen.getByText("Scenarios met")).toBeInTheDocument();
    expect(screen.getByText("Avg composite")).toBeInTheDocument();
    expect(screen.getByText("Bugs")).toBeInTheDocument();
    expect(screen.getByText("Tokens/loop")).toBeInTheDocument();
  });

  it("labels the window size and shows latest values (met as N/M, tokens compact)", () => {
    render(<TrendsStrip points={[pt(1), pt(2), pt(3)]} />);
    expect(screen.getByText("last 3 loops")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();      // latest metCount/scenarioTotal
    expect(screen.getByText("300.0k")).toBeInTheDocument();   // latest tokensTotal, compact
  });

  it("shows a dash for a null latest avgComposite", () => {
    render(<TrendsStrip points={[pt(1), pt(2, { avgComposite: null })]} />);
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});
