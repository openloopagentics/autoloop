import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// Count how often the markdown body actually renders. If popover/selection state
// leaked into the memoized subtree, opening the popover would bump this count.
const bodyRenders = { n: 0 };
vi.mock("../components/Markdown", () => ({
  Markdown: ({ children, className }: { children: string; className?: string }) => {
    bodyRenders.n++;
    return <div className={`md ${className ?? ""}`}>{children}</div>;
  },
}));

// Import AFTER the mock is registered.
const { WikiPage } = await import("./WikiPage");
import type { Page, Scenario, Score, TestRun, Verification } from "../types";

const scn: Scenario = { id: "login", goalId: "g1", title: "Login works", threshold: 80, rubric: { criteria: [{ id: "c", name: "Correctness", weight: 1, max: 5 }] } };
const page: Page = { id: "p1", path: "p1.md", title: "Page 1", markdown: "Users can log in with valid credentials.", scenarioIds: ["login"] };
const empty: Score[] & TestRun[] & Verification[] = [] as never;

afterEach(() => vi.restoreAllMocks());

describe("WikiPage memoization", () => {
  it("does not re-render the markdown body when the popover opens", () => {
    bodyRenders.n = 0;
    const { container } = render(
      <WikiPage page={page} scenarios={[scn]} scores={empty} testRuns={empty} verifications={empty} onComment={async () => {}} />,
    );
    const afterMount = bodyRenders.n;
    expect(afterMount).toBeGreaterThan(0);

    const host = container.querySelector(".wiki-page-host")!;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode()!;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 5);
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false, rangeCount: 1, getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(host);

    // Popover is now open (outer state changed) but the memoized body must not re-render.
    expect(bodyRenders.n).toBe(afterMount);
  });
});
