import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GoalForm } from "./GoalForm";

describe("GoalForm", () => {
  it("submits title + order via onSave and clears", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<GoalForm onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/goal title/i), { target: { value: "Ship" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Ship" })));
    await waitFor(() => expect((screen.getByPlaceholderText(/goal title/i) as HTMLInputElement).value).toBe(""));
  });
  it("disables submit when title is empty", () => {
    render(<GoalForm onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add goal/i })).toBeDisabled();
  });
  it("shows an error when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    render(<GoalForm onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/goal title/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    await waitFor(() => expect(screen.getByText(/nope/)).toBeInTheDocument());
  });
});
