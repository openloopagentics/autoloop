import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WikiPage, type NewComment } from "./WikiPage";
import { CommentSidebar } from "./CommentSidebar";
import type { Page, PageComment, Scenario, Score, TestRun, Verification } from "../types";

const scn: Scenario = { id: "login", goalId: "g1", title: "Login works", threshold: 80, rubric: { criteria: [{ id: "c", name: "Correctness", weight: 1, max: 5 }] } };
const scores: Score[] = [];
const runs: TestRun[] = [];
const verifs: Verification[] = [];
const page = (markdown: string): Page => ({ id: "p1", path: "p1.md", title: "Page 1", markdown, scenarioIds: ["login"] });

/** Force window.getSelection to return a non-collapsed Range over the given text node. */
function mockSelection(container: HTMLElement, text: string): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
    const idx = (tn.textContent ?? "").indexOf(text);
    if (idx === -1) continue;
    const range = document.createRange();
    range.setStart(tn, idx);
    range.setEnd(tn, idx + text.length);
    // jsdom's getBoundingClientRect returns zeros, which is fine for positioning.
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    return;
  }
  throw new Error(`text "${text}" not found in container`);
}

afterEach(() => vi.restoreAllMocks());

describe("WikiPage selection → popover", () => {
  it("shows the popover on a non-collapsed selection inside the page", () => {
    const onComment = vi.fn<(c: NewComment) => Promise<void>>(async () => {});
    const { container } = render(
      <WikiPage page={page("Users can log in with valid credentials.")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} onComment={onComment} />,
    );
    const host = container.querySelector(".wiki-page-host")!;
    mockSelection(host as HTMLElement, "valid credentials");
    fireEvent.mouseUp(host);
    expect(screen.getByRole("dialog", { name: /add a comment/i })).toBeInTheDocument();
    expect(screen.getByText("valid credentials")).toBeInTheDocument(); // the quote
  });

  it("submits the anchor + body + advisory-by-default via onComment", async () => {
    const onComment = vi.fn<(c: NewComment) => Promise<void>>(async () => {});
    const { container } = render(
      <WikiPage page={page("Users can log in with valid credentials.")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} onComment={onComment} />,
    );
    const host = container.querySelector(".wiki-page-host")!;
    mockSelection(host as HTMLElement, "valid credentials");
    fireEvent.mouseUp(host);
    fireEvent.change(screen.getByPlaceholderText(/steer the agent/i), { target: { value: "Please tighten this" } });
    fireEvent.click(screen.getByRole("button", { name: /^comment$/i }));
    await waitFor(() => expect(onComment).toHaveBeenCalledTimes(1));
    const arg = onComment.mock.calls[0][0];
    expect(arg.body).toBe("Please tighten this");
    expect(arg.severity).toBe("advisory"); // default
    expect(arg.anchor.exact).toBe("valid credentials");
    expect(arg.targetScenarioId).toBeUndefined();
  });

  it("toggles severity to blocking when chosen", async () => {
    const onComment = vi.fn<(c: NewComment) => Promise<void>>(async () => {});
    const { container } = render(
      <WikiPage page={page("Users can log in with valid credentials.")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} onComment={onComment} />,
    );
    const host = container.querySelector(".wiki-page-host")!;
    mockSelection(host as HTMLElement, "valid credentials");
    fireEvent.mouseUp(host);
    fireEvent.click(screen.getByRole("radio", { name: /blocking/i }));
    fireEvent.change(screen.getByPlaceholderText(/steer the agent/i), { target: { value: "Do not ship" } });
    fireEvent.click(screen.getByRole("button", { name: /^comment$/i }));
    await waitFor(() => expect(onComment).toHaveBeenCalledTimes(1));
    expect(onComment.mock.calls[0][0].severity).toBe("blocking");
  });

  it("does not crash without the CSS Custom Highlight API (jsdom)", () => {
    // jsdom has no `Highlight`/`CSS.highlights`; the guard must let render succeed.
    expect(typeof (globalThis as { Highlight?: unknown }).Highlight).toBe("undefined");
    const comments: PageComment[] = [{ id: "c1", pageId: "p1", body: "note", status: "open", anchor: { exact: "valid credentials" } }];
    const { container } = render(
      <WikiPage page={page("Users can log in with valid credentials.")} scenarios={[scn]} scores={scores} testRuns={runs} verifications={verifs} comments={comments} onComment={async () => {}} />,
    );
    expect(container.querySelector(".wiki-page-host")).not.toBeNull();
  });
});

describe("CommentSidebar", () => {
  const pageText = "Users can log in with valid credentials.";

  it("shows Accept on a blocking comment for its author", () => {
    const c: PageComment = { id: "c1", pageId: "p1", author: "u1", body: "block", status: "open", severity: "blocking", anchor: { exact: "valid credentials" } };
    render(<CommentSidebar comments={[c]} pageText={pageText} currentUid="u1" isAdmin={false} onAccept={() => {}} />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("hides Accept for a non-author when not admin", () => {
    const c: PageComment = { id: "c1", pageId: "p1", author: "someone-else", body: "block", status: "open", severity: "blocking", anchor: { exact: "valid credentials" } };
    render(<CommentSidebar comments={[c]} pageText={pageText} currentUid="u1" isAdmin={false} onAccept={() => {}} />);
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("shows Accept for an admin regardless of authorship", () => {
    const c: PageComment = { id: "c1", pageId: "p1", author: "someone-else", body: "block", status: "open", severity: "blocking", anchor: { exact: "valid credentials" } };
    render(<CommentSidebar comments={[c]} pageText={pageText} currentUid="u1" isAdmin={true} onAccept={() => {}} />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("fires onAccept with the comment id", () => {
    const onAccept = vi.fn();
    const c: PageComment = { id: "c1", pageId: "p1", author: "u1", body: "block", status: "open", severity: "blocking", anchor: { exact: "valid credentials" } };
    render(<CommentSidebar comments={[c]} pageText={pageText} currentUid="u1" onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onAccept).toHaveBeenCalledWith("c1");
  });

  it("routes a comment whose anchor no longer locates into the Unanchored section", () => {
    const c: PageComment = { id: "c1", pageId: "p1", body: "orphan", status: "open", anchor: { exact: "text that is gone" } };
    const { container } = render(<CommentSidebar comments={[c]} pageText={pageText} currentUid="u1" onAccept={() => {}} />);
    const section = container.querySelector(".cmt-unanchored");
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("orphan");
  });

  it("badges the count of open blocking comments", () => {
    const comments: PageComment[] = [
      { id: "c1", pageId: "p1", body: "b1", status: "open", severity: "blocking", anchor: { exact: "valid credentials" } },
      { id: "c2", pageId: "p1", body: "b2", status: "open", severity: "advisory", anchor: { exact: "log in" } },
    ];
    render(<CommentSidebar comments={comments} pageText={pageText} currentUid="u1" onAccept={() => {}} />);
    expect(screen.getByLabelText(/1 open blocking comments/i)).toHaveTextContent("1");
  });

  it("does not count an accepted+resolved blocking comment", () => {
    const comments: PageComment[] = [
      { id: "c1", pageId: "p1", body: "b1", status: "resolved", accepted: true, severity: "blocking", anchor: { exact: "valid credentials" } },
    ];
    const { container } = render(<CommentSidebar comments={comments} pageText={pageText} currentUid="u1" onAccept={() => {}} />);
    expect(container.querySelector(".cmt-blocking-count")).toBeNull();
  });
});
