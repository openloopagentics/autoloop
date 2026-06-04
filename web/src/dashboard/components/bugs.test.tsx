import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BugsList } from "./BugsList";
import type { Bug } from "../types";

const bugs: Bug[] = [
  { id: "b1", title: "Fixed one", status: "fixed", severity: "low" },
  { id: "b2", title: "Open high", status: "open", severity: "high" },
];

describe("BugsList", () => {
  it("renders open before fixed and shows severity + status", () => {
    const { container } = render(<BugsList bugs={bugs} />);
    const titles = Array.from(container.querySelectorAll(".bugrow-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Open high", "Fixed one"]); // open first
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("fixed")).toBeInTheDocument();
  });
  it("shows an empty state when there are no bugs", () => {
    render(<BugsList bugs={[]} />);
    expect(screen.getByText(/no bugs/i)).toBeInTheDocument();
  });
});
