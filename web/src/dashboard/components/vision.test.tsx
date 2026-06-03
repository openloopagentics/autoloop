import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenariosMetBanner } from "./ScenariosMetBanner";
import { ScenarioCard } from "./ScenarioCard";
import { PlanSection } from "./PlanSection";
import { PhaseItem } from "./PhaseItem";
import { TaskItem } from "./TaskItem";
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

describe("PlanSection legacy fallback", () => {
  it("renders the Phases header + phases when there are no tasks", () => {
    render(<PlanSection
      phases={[{ id: "build", name: "Build", order: 1, status: "running" }]} tasks={[]}
      renderLegacyPhase={(p) => <PhaseItem phase={p} commits={[{ sha: "abcdef1", message: "init", author: "a" }]} />}
      renderTask={() => null} />);
    expect(screen.getByText("Phases")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("init")).toBeInTheDocument();
  });
  it("renders the phase->task tree when tasks exist", () => {
    render(<PlanSection
      phases={[{ id: "build", name: "Build", order: 1, status: "running" }]}
      tasks={[{ id: "login", phaseId: "build", title: "Login", order: 1, status: "completed", scenarioIds: ["s1"] }]}
      renderLegacyPhase={() => null}
      renderTask={(t) => <TaskItem task={t} commits={[{ sha: "c0ffee1", message: "feat", author: "a" }]} />} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.getByText("feat")).toBeInTheDocument();
  });
});
