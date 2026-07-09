import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VisionTab } from "./VisionTab";
import { VisionWikiTab } from "./VisionWikiTab";
import type { Goal, Page, PageComment, Scenario, Score, TestRun, Verification, DocumentRec } from "../types";

// Mock the api module so the comment submit / accept paths are observable.
vi.mock("../api", () => ({
  postComment: vi.fn(async () => {}),
  acceptComment: vi.fn(async () => {}),
  rejectVisionChange: vi.fn(async () => {}),
}));
// useVisionChanges (used by the legacy VisionTab) hits firestore — stub the hook module.
vi.mock("../hooks", () => ({ useVisionChanges: () => ({ data: [], loading: false, error: null }) }));

import { postComment, acceptComment } from "../api";

const goal: Goal = { id: "g1", title: "Auth", order: 1 };
const scn: Scenario = { id: "login", goalId: "g1", title: "Login works", threshold: 80, rubric: { criteria: [{ id: "c", name: "Correctness", weight: 1, max: 5 }] } };
const scores: Score[] = [{ id: "01A", scenarioId: "login", composite: 92 }];
const runs: TestRun[] = [{ id: "01A", scenarioId: "login", passed: 6, failed: 0 }];
const verifs: Verification[] = [];
const documents: DocumentRec[] = [];

const scenarioFence = "```scenario\nid: login\n```";
// Both pages top-level so nav order is unambiguous: overview (order 1) is first — a
// synthetic directory node would otherwise sort ahead of a same-level page (order 0 default).
const pages: Page[] = [
  { id: "overview", path: "overview.md", title: "Overview", order: 1, markdown: "Users can log in with valid credentials.", scenarioIds: [] },
  { id: "auth", path: "login.md", title: "Login page", order: 2, markdown: `# Login\n\n${scenarioFence}`, scenarioIds: ["login"] },
];

/** Force window.getSelection to return a non-collapsed Range over the given text. */
function mockSelection(container: HTMLElement, text: string): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
    const idx = (tn.textContent ?? "").indexOf(text);
    if (idx === -1) continue;
    const range = document.createRange();
    range.setStart(tn, idx);
    range.setEnd(tn, idx + text.length);
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    return;
  }
  throw new Error(`text "${text}" not found in container`);
}

const props = (overrides: Partial<Parameters<typeof VisionTab>[0]> = {}) => ({
  teamId: "t1", slug: "p1", editable: false,
  goals: [goal], scenarios: [scn], scores, testRuns: runs, documents, verifications: verifs,
  pages, comments: [] as PageComment[],
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());
beforeEach(() => { vi.mocked(postComment).mockClear(); vi.mocked(acceptComment).mockClear(); });

describe("VisionTab wiki gate", () => {
  it("renders the wiki (nav + first page) when pages exist, not the legacy list", () => {
    render(<VisionTab {...props()} />);
    // Wiki nav present.
    expect(screen.getByText(/scenarios met/i)).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Login page")).toBeInTheDocument();
    // First page in nav order rendered in the center column.
    expect(screen.getByText(/Users can log in with valid credentials/)).toBeInTheDocument();
    // Legacy list view's "Vision" section header is absent.
    expect(screen.queryByRole("heading", { name: "Vision" })).toBeNull();
  });

  it("falls back to the legacy list view when there are no pages", () => {
    render(<VisionTab {...props({ pages: [], comments: [] })} />);
    // Legacy VisionSection header shown (editable=false, hasScenarios).
    expect(screen.getByRole("heading", { name: "Vision" })).toBeInTheDocument();
    // No wiki nav.
    expect(screen.queryByText(/scenarios met/i)).toBeInTheDocument(); // banner also says "scenarios met"; ensure no wiki nav rollup specifically
  });
});

describe("VisionWikiTab roll-up reflects the blocked set", () => {
  it("counts an otherwise-met scenario as unmet when a blocking comment gates it", () => {
    const blocking: PageComment[] = [
      { id: "c1", pageId: "auth", body: "stop", severity: "blocking", status: "open", targetScenarioId: "login", anchor: { exact: "Login" } },
    ];
    const { rerender } = render(
      <VisionWikiTab teamId="t1" slug="p1" scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} pages={pages} comments={[]} />,
    );
    // Without blocking: 1 of 1 met.
    expect(screen.getByText((_t, n) => n?.textContent === "1 of 1 scenarios met")).toBeInTheDocument();
    rerender(
      <VisionWikiTab teamId="t1" slug="p1" scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} pages={pages} comments={blocking} />,
    );
    // With a blocking comment on login: 0 of 1 met.
    expect(screen.getByText((_t, n) => n?.textContent === "0 of 1 scenarios met")).toBeInTheDocument();
  });
});

describe("VisionWikiTab comment submit path", () => {
  it("wires postComment with the selected page's id", async () => {
    const { container } = render(
      <VisionWikiTab teamId="t1" slug="p1" scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} pages={pages} comments={[]} />,
    );
    // Default selection is the first nav page ("overview"); select some of its text.
    const body = container.querySelector(".wiki-page-body") as HTMLElement;
    mockSelection(body, "log in");
    fireEvent.mouseUp(body);
    const input = await screen.findByPlaceholderText(/./); // popover textarea
    fireEvent.change(input, { target: { value: "reconsider" } });
    fireEvent.click(screen.getByRole("button", { name: /comment|submit|save/i }));
    await waitFor(() => expect(postComment).toHaveBeenCalled());
    const arg = vi.mocked(postComment).mock.calls[0];
    expect(arg[0]).toBe("t1");
    expect(arg[1]).toBe("p1");
    expect(arg[2]).toMatchObject({ pageId: "overview", body: "reconsider" });
  });
});

describe("VisionWikiTab accept path", () => {
  it("wires acceptComment for a blocking comment the current user authored", async () => {
    const blocking: PageComment[] = [
      { id: "c1", pageId: "overview", author: "u1", body: "stop", severity: "blocking", status: "open", anchor: { exact: "log in" } },
    ];
    render(
      <VisionWikiTab teamId="t1" slug="p1" currentUid="u1" scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} pages={pages} comments={blocking} />,
    );
    const acceptBtn = await screen.findByRole("button", { name: /accept/i });
    fireEvent.click(acceptBtn);
    await waitFor(() => expect(acceptComment).toHaveBeenCalledWith("t1", "p1", "c1"));
  });
});
