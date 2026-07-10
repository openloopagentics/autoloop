import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectHeader } from "./ProjectHeader";
import { PhaseItem } from "./PhaseItem";
import { CommitItem } from "./CommitItem";

describe("ProjectHeader", () => {
  it("renders a link for url design and preformatted for markdown", () => {
    const { rerender } = render(<ProjectHeader project={{ slug: "web", title: "Web", status: "running", design: { format: "url", content: "https://x/plan" } }} />);
    expect(screen.getByRole("link", { name: /plan/i })).toHaveAttribute("href", "https://x/plan");
    rerender(<ProjectHeader project={{ slug: "web", title: "Web", status: "running", design: { format: "markdown", content: "# Plan" } }} />);
    expect(screen.getByText("# Plan")).toBeInTheDocument();
  });

  it("offers Restart loop when the effective status is not running; hides it while genuinely running", () => {
    const onRestart = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ProjectHeader project={{ slug: "web" }} status="paused" onRestart={onRestart} />);
    fireEvent.click(screen.getByRole("button", { name: /restart loop/i }));
    expect(onRestart).toHaveBeenCalled();
    rerender(<ProjectHeader project={{ slug: "web" }} status="running" onRestart={onRestart} />);
    expect(screen.queryByRole("button", { name: /restart loop/i })).toBeNull();
  });

  it("shows 'restart requested' instead of the button once wakeRequestedAt is set", () => {
    render(<ProjectHeader project={{ slug: "web", wakeRequestedAt: { seconds: 1 } }} status="paused" onRestart={vi.fn()} />);
    expect(screen.getByText(/restart requested/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restart loop/i })).toBeNull();
  });

  it("surfaces a restart failure and re-enables the button", async () => {
    const onRestart = vi.fn().mockRejectedValue(new Error("forbidden"));
    render(<ProjectHeader project={{ slug: "web" }} status="blocked" onRestart={onRestart} />);
    fireEvent.click(screen.getByRole("button", { name: /restart loop/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("forbidden"));
    expect(screen.getByRole("button", { name: /restart loop/i })).toBeEnabled();
  });
});

describe("PhaseItem", () => {
  it("shows phase name+status and its commits, or empty", () => {
    const { rerender } = render(<PhaseItem phase={{ name: "Build", order: 1, status: "running" }} commits={[{ sha: "abcdef1", message: "init", author: "a" }]} />);
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("init")).toBeInTheDocument();
    rerender(<PhaseItem phase={{ name: "Build", order: 1, status: "running" }} commits={[]} />);
    expect(screen.getByText(/no commits yet/i)).toBeInTheDocument();
  });
});

describe("CommitItem", () => {
  it("shows short sha, message, author", () => {
    render(<CommitItem commit={{ sha: "deadbeefcafe", message: "fix", author: "alice" }} />);
    expect(screen.getByText("fix")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText(/deadbee/)).toBeInTheDocument();
  });
});
