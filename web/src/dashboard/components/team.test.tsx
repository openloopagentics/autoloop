import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  const mixed = [
    { slug: "web", title: "Web", status: "running" },
    { slug: "api", title: "Api", status: "paused" },
    { slug: "ios", title: "Ios", status: "completed" },
  ];
  it("filter='running' shows only running projects and a hidden-count note", () => {
    wrap(<TeamSection team={team} projects={mixed} loading={false} error={null} filter="running" />);
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.queryByText("Api")).toBeNull();
    expect(screen.queryByText("Ios")).toBeNull();
    expect(screen.getByText(/2 hidden/)).toBeInTheDocument();
  });
  it("filter='all' (and no filter) shows everything with no hidden note", () => {
    const { rerender } = wrap(<TeamSection team={team} projects={mixed} loading={false} error={null} filter="all" />);
    expect(screen.getByText("Api")).toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).toBeNull();
    rerender(<MemoryRouter><TeamSection team={team} projects={mixed} loading={false} error={null} /></MemoryRouter>);
    expect(screen.getByText("Ios")).toBeInTheDocument();
  });
  it("all projects filtered out → 'No running projects' note with a Show all tap that fires onShowAll", () => {
    const onShowAll = vi.fn();
    wrap(<TeamSection team={team} projects={[{ slug: "api", title: "Api", status: "paused" }]} loading={false} error={null} filter="running" onShowAll={onShowAll} />);
    expect(screen.getByText(/no running projects/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    expect(onShowAll).toHaveBeenCalled();
  });
  it("empty team keeps its normal empty state regardless of filter", () => {
    wrap(<TeamSection team={team} projects={[]} loading={false} error={null} filter="running" />);
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });
});
