import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VisionChangesFeed } from "./VisionChangesFeed";
import { VisionChangeCard } from "./VisionChangeCard";
import type { VisionChange } from "../types";

const applied: VisionChange = {
  id: "01B", op: "upsert-scenario", targetId: "login", reason: "found while testing",
  status: "applied", createdAt: Date.now() - 60_000,
};
const rejected: VisionChange = {
  id: "01A", op: "upsert-goal", targetId: "ship", reason: "old idea",
  status: "rejected", createdAt: Date.now() - 120_000, decidedAt: Date.now() - 30_000,
};

afterEach(() => vi.restoreAllMocks());

describe("VisionChangesFeed", () => {
  it("renders nothing when there are no changes", () => {
    const { container } = render(<VisionChangesFeed changes={[]} goals={[]} scenarios={[]} onReject={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("lists changes in the given (newest-first) order with resolved target titles", () => {
    render(<VisionChangesFeed changes={[applied, rejected]}
      goals={[{ id: "ship", title: "Ship it" }]} scenarios={[{ id: "login", title: "Login works" }]}
      onReject={vi.fn()} />);
    expect(screen.getByText(/Changes/)).toBeInTheDocument(); // collapsible summary
    const titles = screen.getAllByText(/Login works|Ship it/).map((n) => n.textContent);
    expect(titles[0]).toBe("Login works"); // newest (the hook supplies desc ULID order)
    expect(titles[1]).toBe("Ship it");
    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });
  it("falls back to the targetId when the target was deleted", () => {
    render(<VisionChangesFeed changes={[applied]} goals={[]} scenarios={[]} onReject={vi.fn()} />);
    expect(screen.getByText("login")).toBeInTheDocument();
  });
});

describe("VisionChangeCard", () => {
  it("Reject asks for confirmation, calls onReject, and flips the chip", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<VisionChangeCard change={applied} targetTitle="Login works" onReject={onReject} />);
    expect(screen.getByText("Applied")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reject change 01B/i }));
    await waitFor(() => expect(onReject).toHaveBeenCalledWith("01B"));
    expect(screen.getByText("Rejected")).toBeInTheDocument(); // flips without waiting for the snapshot
  });
  it("does nothing when the confirm is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onReject = vi.fn();
    render(<VisionChangeCard change={applied} targetTitle="Login works" onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /reject change 01B/i }));
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });
  it("shows the reject error without flipping the chip", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onReject = vi.fn().mockRejectedValue(new Error("HTTP 403"));
    render(<VisionChangeCard change={applied} targetTitle="Login works" onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /reject change 01B/i }));
    await waitFor(() => expect(screen.getByText(/HTTP 403/)).toBeInTheDocument());
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });
  it("renders a rejected change struck-through (vchange--rejected) with no Reject button", () => {
    render(<VisionChangeCard change={rejected} targetTitle="Ship it" onReject={vi.fn()} />);
    expect(screen.getByText("Ship it").closest(".vchange")).toHaveClass("vchange--rejected");
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
  });
  it("shows the reason and relative times", () => {
    render(<VisionChangeCard change={rejected} targetTitle="Ship it" onReject={vi.fn()} />);
    expect(screen.getByText("old idea")).toBeInTheDocument();
    expect(screen.getByText(/ago|just now/)).toBeInTheDocument();
  });
});
