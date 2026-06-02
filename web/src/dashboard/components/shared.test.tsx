import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { EmptyState } from "./EmptyState";
import { ErrorNote } from "./ErrorNote";
import { Spinner } from "./Spinner";

describe("shared components", () => {
  it("StatusBadge shows the status text and a color data attr", () => {
    render(<StatusBadge status="running" />);
    const el = screen.getByText("running");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-color", "blue");
  });
  it("EmptyState renders its message", () => {
    render(<EmptyState message="No teams" />);
    expect(screen.getByText("No teams")).toBeInTheDocument();
  });
  it("ErrorNote renders its message with role=alert", () => {
    render(<ErrorNote message="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
  it("Spinner has role=status", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
