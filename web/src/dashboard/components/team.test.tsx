import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectCard } from "./ProjectCard";
import { TeamSection } from "./TeamSection";

function wrap(node: React.ReactNode) { return render(<MemoryRouter>{node}</MemoryRouter>); }

describe("ProjectCard", () => {
  it("shows title, status, current phase, and links to detail", () => {
    wrap(<ProjectCard teamId="t1" project={{ slug: "web", title: "Web", status: "running", currentPhaseId: "build" }} />);
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/build/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard/t1/web");
  });
  it("shows 'no active phase' when currentPhaseId is null", () => {
    wrap(<ProjectCard teamId="t1" project={{ slug: "web", title: "Web", status: "queued", currentPhaseId: null }} />);
    expect(screen.getByText(/no active phase/i)).toBeInTheDocument();
  });
});

describe("TeamSection", () => {
  const team = { name: "Acme" };
  it("spinner when loading, error when error, empty when no projects, cards when populated", () => {
    const { rerender } = wrap(<TeamSection team={team} projects={[]} loading={true} error={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<MemoryRouter><TeamSection team={team} projects={[]} loading={false} error={"x"} /></MemoryRouter>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<MemoryRouter><TeamSection team={team} projects={[]} loading={false} error={null} /></MemoryRouter>);
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    rerender(<MemoryRouter><TeamSection team={team} projects={[{ slug: "web", title: "Web", status: "running", currentPhaseId: "build" }]} loading={false} error={null} /></MemoryRouter>);
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
