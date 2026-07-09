import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WikiPage } from "./WikiPage";
import { WikiNav } from "./WikiNav";
import type { Page, Scenario, Score, TestRun, Verification } from "../types";

// Mock the mermaid dynamic import so tests don't pull in the real (heavy) renderer.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg data-id="${id}">diagram</svg>` })),
  },
}));

const scn: Scenario = { id: "login", goalId: "g1", title: "Login works", threshold: 80, rubric: { criteria: [{ id: "c", name: "Correctness", weight: 1, max: 5 }] } };
const scores: Score[] = [{ id: "01A", scenarioId: "login", composite: 92 }];
const runs: TestRun[] = [{ id: "01A", scenarioId: "login", passed: 6, failed: 0 }];
const verifs: Verification[] = [];

const page = (markdown: string): Page => ({ id: "p1", path: "p1.md", title: "Page 1", markdown, scenarioIds: ["login"] });

const scenarioFence = "```scenario\nid: login\n```";
const goalFence = "```goal\nid: g1\ntitle: Auth goal\ndescription: Users can log in\n```";

describe("WikiPage", () => {
  it("renders a scenario fence as a live ScenarioCard with the scenario title", () => {
    render(<WikiPage page={page(scenarioFence)} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(screen.getByText("Login works")).toBeInTheDocument();
  });

  it("flows met state from scores/testRuns props", () => {
    render(<WikiPage page={page(scenarioFence)} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(screen.getAllByText(/met/i).length).toBeGreaterThan(0);
    expect(screen.getByText("92")).toBeInTheDocument();
  });

  it("shows unmet when the score is below threshold", () => {
    render(<WikiPage page={page(scenarioFence)} scenarios={[scn]} scores={[{ id: "01A", scenarioId: "login", composite: 40 }]} testRuns={runs} verifications={verifs} />);
    expect(screen.getByText(/unmet/i)).toBeInTheDocument();
  });

  it("puts a data-scenario-id attribute on scenario cards", () => {
    const { container } = render(<WikiPage page={page(scenarioFence)} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(container.querySelector('[data-scenario-id="login"]')).not.toBeNull();
  });

  it("shows a blocked badge when the scenario is blocked", () => {
    const { container } = render(<WikiPage page={page(scenarioFence)} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} blockedIds={new Set(["login"])} />);
    expect(container.querySelector(".wiki-blocked-badge")).toHaveTextContent("blocked");
    // Blocking also gates the card's own state to unmet.
    expect(screen.getByText(/unmet/i)).toBeInTheDocument();
  });

  it("renders a goal fence as a compact goal header", () => {
    render(<WikiPage page={page(goalFence)} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(screen.getByText("Auth goal")).toBeInTheDocument();
    expect(screen.getByText("Users can log in")).toBeInTheDocument();
  });

  it("renders a mermaid fence via the Mermaid component (mocked import)", async () => {
    const { container } = render(<WikiPage page={page("```mermaid\ngraph TD; A-->B;\n```")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    await waitFor(() => expect(container.querySelector(".wiki-mermaid svg")).not.toBeNull());
  });

  it("renders an 'invalid block' note for a malformed scenario block but still renders the page", () => {
    const md = `# Heading\n\n\`\`\`scenario\nid: does-not-exist\n\`\`\``;
    render(<WikiPage page={page(md)} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(screen.getByText(/invalid block/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  });

  it("renders a non-goal/scenario/mermaid fence as a plain code block", () => {
    const { container } = render(<WikiPage page={page("```js\nconst x = 1;\n```")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(container.querySelector("code")).not.toBeNull();
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
    expect(screen.queryByText(/invalid block/i)).toBeNull();
  });
});

describe("WikiNav", () => {
  const pages: Page[] = [
    { id: "overview", path: "overview.md", title: "Overview", order: 1, scenarioIds: [] },
    { id: "p1", path: "auth/login.md", title: "Login", order: 1, scenarioIds: ["login"] },
  ];

  it("renders a roll-up header of scenarios met", () => {
    render(<WikiNav pages={pages} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} selectedPageId={null} onSelect={() => {}} />);
    expect(screen.getByText(/scenarios met/i)).toBeInTheDocument();
  });

  it("shows a per-page met chip and a synthetic directory node", () => {
    render(<WikiNav pages={pages} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} selectedPageId={null} onSelect={() => {}} />);
    expect(screen.getByText("auth")).toBeInTheDocument(); // synthetic dir
    expect(screen.getByText("1/1")).toBeInTheDocument(); // met chip for the login page
  });

  it("fires onSelect and highlights the selected page", () => {
    const onSelect = vi.fn();
    render(<WikiNav pages={pages} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} selectedPageId="overview" onSelect={onSelect} />);
    const selected = screen.getByText("Overview").closest("button");
    expect(selected).toHaveClass("is-selected");
    screen.getByText("Login").closest("button")!.click();
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("renders the unanchored-comments stub container", () => {
    render(<WikiNav pages={pages} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} selectedPageId={null} onSelect={() => {}} />);
    expect(screen.getByText(/unanchored comments/i)).toBeInTheDocument();
  });
});
