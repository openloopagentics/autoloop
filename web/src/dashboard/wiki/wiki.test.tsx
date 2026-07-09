import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import mermaid from "mermaid";
import { WikiPage } from "./WikiPage";
import { WikiNav } from "./WikiNav";
import type { Page, PageComment, Scenario, Score, TestRun, Verification } from "../types";

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

  it("falls back to the source <pre> when mermaid render rejects", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("parse error"));
    const { container } = render(<WikiPage page={page("```mermaid\nnot a diagram\n```")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    await waitFor(() => expect(container.querySelector(".wiki-mermaid-err")).not.toBeNull());
    expect(container.querySelector(".wiki-mermaid-err")).toHaveTextContent("not a diagram");
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

  it("does NOT nest a scenario card inside a <pre> wrapper", () => {
    const { container } = render(<WikiPage page={page(scenarioFence)} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(container.querySelector("pre .scncard")).toBeNull(); // no pre chrome around the card
    expect(container.querySelector(".scncard")).not.toBeNull(); // card still rendered
    expect(container.querySelector("[data-scenario-id] pre")).toBeNull(); // no leftover pre inside the wrapper
  });

  it("keeps the default <pre> wrapper for an ordinary code fence", () => {
    const { container } = render(<WikiPage page={page("```js\nconst x = 1;\n```")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} />);
    expect(container.querySelector("pre code")).not.toBeNull(); // default pre>code preserved
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

  it("omits the unanchored-comments section when there are no orphaned comments", () => {
    render(<WikiNav pages={pages} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} selectedPageId={null} onSelect={() => {}} />);
    expect(screen.queryByText(/unanchored comments/i)).toBeNull();
  });

  it("lists open comments whose page no longer exists, with their quoted text", () => {
    const comments: PageComment[] = [
      { id: "c1", pageId: "gone.md", body: "Reconsider this", status: "open", anchor: { exact: "removed passage" } },
      { id: "c2", pageId: "overview", body: "on a live page", status: "open", anchor: { exact: "still here" } },
    ];
    render(<WikiNav pages={pages} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} comments={comments} selectedPageId={null} onSelect={() => {}} />);
    expect(screen.getByText(/unanchored comments/i)).toBeInTheDocument();
    expect(screen.getByText(/removed passage/)).toBeInTheDocument();
    // A comment anchored to a live page is NOT listed as unanchored.
    expect(screen.queryByText(/still here/)).toBeNull();
  });
});
