import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";
import { LoopSelector } from "./LoopSelector";
import type { SelectableLoop } from "../loopView";

describe("Tabs", () => {
  it("renders the four tabs, marks the active one, and fires onChange", () => {
    const onChange = vi.fn();
    render(<Tabs active="dashboard" onChange={onChange} />);
    for (const t of ["Dashboard", "Vision", "Loops", "Tests", "Bugs", "Ideas", "Messages"]) expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Loops" }));
    expect(onChange).toHaveBeenCalledWith("loops");
  });
});

describe("LoopSelector", () => {
  const loops: SelectableLoop[] = [
    { id: "l1", isMain: false, goal: "Search", status: "completed" },
    { id: "l2", isMain: false, name: "Payments", status: "running" },
    { id: "main", isMain: true, name: "main", status: "running" },
  ];
  it("renders an option per loop (main labeled legacy) and fires onChange", () => {
    const onChange = vi.fn();
    render(<LoopSelector loops={loops} selectedId="l2" onChange={onChange} />);
    expect(screen.getByText(/main \(legacy\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "l1" } });
    expect(onChange).toHaveBeenCalledWith("l1");
  });
  it("renders nothing for a single loop", () => {
    const { container } = render(<LoopSelector loops={[loops[0]]} selectedId="l1" onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
