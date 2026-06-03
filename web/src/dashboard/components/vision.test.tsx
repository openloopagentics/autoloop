import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenariosMetBanner } from "./ScenariosMetBanner";
import { ScenarioCard } from "./ScenarioCard";
import type { Scenario, Score, TestRun } from "../types";

const scn: Scenario = { id: "login", goalId: "g1", title: "Login works", threshold: 80, rubric: { criteria: [{ id: "c", name: "Correctness", weight: 1, max: 5 }] } };

describe("ScenariosMetBanner", () => {
  it("shows N / M scenarios met", () => {
    render(<ScenariosMetBanner met={3} total={5} />);
    expect(screen.getByText(/3\s*\/\s*5/)).toBeInTheDocument();
    expect(screen.getByText(/scenarios met/i)).toBeInTheDocument();
  });
});

describe("ScenarioCard", () => {
  const scores: Score[] = [{ id: "01A", scenarioId: "login", composite: 92 }];
  const runs: TestRun[] = [{ id: "01A", scenarioId: "login", passed: 6, failed: 0 }];
  it("renders title, met state, composite, and test counts when met", () => {
    render(<ScenarioCard scenario={scn} scores={scores} testRuns={runs} />);
    expect(screen.getByText("Login works")).toBeInTheDocument();
    expect(screen.getByText(/met/i)).toBeInTheDocument();
    expect(screen.getByText(/92/)).toBeInTheDocument();
    expect(screen.getByText(/6/)).toBeInTheDocument(); // passed
  });
  it("shows unmet when below threshold", () => {
    render(<ScenarioCard scenario={scn} scores={[{ id: "01A", scenarioId: "login", composite: 50 }]} testRuns={runs} />);
    expect(screen.getByText(/unmet/i)).toBeInTheDocument();
  });
});
