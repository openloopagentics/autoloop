import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
