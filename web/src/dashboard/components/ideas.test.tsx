import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IdeasTab } from "../tabs/IdeasTab";
import type { Idea } from "../types";

const ideas: Idea[] = [
  { id: "p1", title: "Proposed one", status: "proposed", order: 100, by: "agent", rationale: "because", originLoopId: "loop-1" },
  { id: "a1", title: "Accepted one", status: "accepted", order: 50, by: "user" },
  { id: "r1", title: "Rejected one", status: "rejected", order: 1, by: "user" },
  { id: "d1", title: "Done one", status: "done", order: 1, by: "agent", builtInLoopId: "loop-2" },
];

describe("IdeasTab", () => {
  it("renders rows band-sorted (accepted, proposed, rejected, done) with status chips", () => {
    const { container } = render(<IdeasTab ideas={ideas} onPut={vi.fn()} />);
    const titles = Array.from(container.querySelectorAll(".idearow-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Accepted one", "Proposed one", "Rejected one", "Done one"]);
    for (const s of ["proposed", "accepted", "rejected", "done"]) {
      expect(container.querySelector(`.ideastatus--${s}`)).not.toBeNull();
    }
  });

  it("shows rationale (collapsible) and loop references", () => {
    const { container } = render(<IdeasTab ideas={ideas} onPut={vi.fn()} />);
    expect(container.textContent).toContain("because");
    expect(container.textContent).toContain("loop-1");
    expect(container.textContent).toContain("loop-2");
  });

  it("Accept / Reject call onPut with the status body; rejected/done rows have no buttons", () => {
    const onPut = vi.fn().mockResolvedValue(undefined);
    render(<IdeasTab ideas={ideas} onPut={onPut} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^accept$/i })[0]); // accepted+proposed rows have buttons
    expect(onPut).toHaveBeenCalledWith(expect.any(String), { status: "accepted" });
    fireEvent.click(screen.getAllByRole("button", { name: /^reject$/i })[0]);
    expect(onPut).toHaveBeenCalledWith(expect.any(String), { status: "rejected" });
    expect(screen.getAllByRole("button", { name: /^accept$/i }).length).toBe(2); // only proposed + accepted rows
  });

  it("↑/↓ reorder PUTs new orders, renumbering ties so the move is never a no-op", async () => {
    const onPut = vi.fn().mockResolvedValue(undefined);
    const tied: Idea[] = [
      { id: "p1", title: "P1", status: "proposed", order: 100, createdAt: { toMillis: () => 1 } },
      { id: "p2", title: "P2", status: "proposed", order: 100, createdAt: { toMillis: () => 2 } },
    ];
    render(<IdeasTab ideas={tied} onPut={onPut} />);
    fireEvent.click(screen.getAllByRole("button", { name: /move up/i })[1]); // move p2 up
    await waitFor(() => expect(onPut).toHaveBeenCalled());
    const orders = Object.fromEntries((onPut.mock.calls as [string, { order: number }][]).map(([id, body]) => [id, body.order]));
    expect(orders.p2).toBeLessThan(orders.p1 ?? Infinity); // p2 now sorts first
  });

  it("add-idea form posts a proposed idea with a slugified id", async () => {
    const onPut = vi.fn().mockResolvedValue(undefined);
    render(<IdeasTab ideas={[]} onPut={onPut} />);
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "Add Dark Mode" } });
    fireEvent.change(screen.getByPlaceholderText(/rationale/i), { target: { value: "users asked" } });
    fireEvent.click(screen.getByRole("button", { name: /add idea/i }));
    await waitFor(() => expect(onPut).toHaveBeenCalledWith("add-dark-mode",
      { title: "Add Dark Mode", rationale: "users asked", status: "proposed", order: 100 }));
  });

  it("shows an empty state when there are no ideas", () => {
    render(<IdeasTab ideas={[]} onPut={vi.fn()} />);
    expect(screen.getByText(/no ideas/i)).toBeInTheDocument();
  });
});
