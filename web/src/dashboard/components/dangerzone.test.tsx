import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DangerZone } from "./DangerZone";

describe("DangerZone", () => {
  it("requires typing the exact slug before delete is enabled, then calls onDelete", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<DangerZone slug="loopexp" onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    const confirmBtn = screen.getByRole("button", { name: /delete this project/i });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "loopexp" } });
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it("surfaces an error if onDelete rejects", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("forbidden"));
    render(<DangerZone slug="x" onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /delete this project/i }));
    expect(await screen.findByText(/forbidden/)).toBeInTheDocument();
  });
});
