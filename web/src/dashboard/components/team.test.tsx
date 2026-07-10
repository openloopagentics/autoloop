import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectCard } from "./ProjectCard";
import { visibleProjects } from "./TeamTiles";
import { GridNote } from "../DashboardHome";

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
  it("shows the team name as a label on the tile", () => {
    const { container } = wrap(<ProjectCard teamId="t1" teamName="Acme" project={{ slug: "web", title: "Web" }} />);
    expect(container.querySelector(".pcard-team")?.textContent).toBe("Acme");
  });
});

describe("visibleProjects — the filter keys on the EFFECTIVE status the badge shows", () => {
  const projects = [
    { slug: "a", status: "running" },   // stored says running…
    { slug: "b", status: "paused" },    // stored says paused…
  ];
  it("effective status beats stored in both directions", () => {
    // a's loops are all done (effective completed) → hidden despite stored "running";
    // b has a live loop (effective running) → shown despite stored "paused".
    const statuses = { a: "completed", b: "running" };
    expect(visibleProjects(projects, statuses, "running").map((p) => p.slug)).toEqual(["b"]);
  });
  it("unreported projects are NOT shown under 'running' — tiles appear as statuses settle, never flash out", () => {
    // On reload, before any loops snapshot arrives, nothing may show under the default
    // filter from stored-status guesses (the wrong-then-corrected flash).
    expect(visibleProjects(projects, {}, "running")).toEqual([]);
  });
  it("a reported undefined effective status does not fall back to stored", () => {
    expect(visibleProjects(projects, { a: undefined }, "running").map((p) => p.slug)).toEqual([]);
  });
  it("'all' ignores statuses entirely", () => {
    expect(visibleProjects(projects, { a: "completed", b: "failed" }, "all")).toHaveLength(2);
  });
});

describe("GridNote — the single note under the grid", () => {
  const onShowAll = vi.fn();
  it("stays silent until every team has reported (no flash of 'no projects')", () => {
    const { container } = render(<GridNote counts={{ t1: { visible: 0, total: 0 } }} teamCount={2} filter="running" onShowAll={onShowAll} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("zero projects across all teams → empty state", () => {
    render(<GridNote counts={{ t1: { visible: 0, total: 0 }, t2: { visible: 0, total: 0 } }} teamCount={2} filter="running" onShowAll={onShowAll} />);
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });
  it("everything filtered out → 'No running projects · N hidden' with a working Show all", () => {
    render(<GridNote counts={{ t1: { visible: 0, total: 2 }, t2: { visible: 0, total: 1 } }} teamCount={2} filter="running" onShowAll={onShowAll} />);
    expect(screen.getByText(/no running projects · 3 hidden/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    expect(onShowAll).toHaveBeenCalled();
  });
  it("partly filtered → 'N hidden'; nothing hidden → renders nothing", () => {
    const { container, rerender } = render(<GridNote counts={{ t1: { visible: 1, total: 3 } }} teamCount={1} filter="running" onShowAll={onShowAll} />);
    expect(screen.getByText(/2 hidden/)).toBeInTheDocument();
    rerender(<GridNote counts={{ t1: { visible: 3, total: 3 } }} teamCount={1} filter="running" onShowAll={onShowAll} />);
    expect(container).toBeEmptyDOMElement();
  });
});
