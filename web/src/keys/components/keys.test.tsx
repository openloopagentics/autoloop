import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyMintForm } from "./KeyMintForm";
import { NewKeyReveal } from "./NewKeyReveal";
import { KeyRow } from "./KeyRow";
import { KeyList } from "./KeyList";

describe("KeyMintForm", () => {
  it("submits the label and disables the button while pending", async () => {
    const onMint = vi.fn();
    const { rerender } = render(<KeyMintForm onMint={onMint} pending={false} />);
    await userEvent.type(screen.getByLabelText(/label/i), "laptop");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(onMint).toHaveBeenCalledWith("laptop");
    rerender(<KeyMintForm onMint={onMint} pending={true} />);
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });
});

describe("NewKeyReveal", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  it("shows the plaintext, copies, and dismisses", async () => {
    const onDismiss = vi.fn();
    render(<NewKeyReveal keyValue="dl_secret123" onDismiss={onDismiss} />);
    expect(screen.getByText("dl_secret123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("dl_secret123");
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("KeyRow / KeyList", () => {
  it("KeyRow shows prefix+label and revokes", async () => {
    const onRevoke = vi.fn();
    render(<KeyRow keyMeta={{ id: "h1", label: "laptop", prefix: "dl_ab12c" }} onRevoke={onRevoke} />);
    expect(screen.getByText(/dl_ab12c/)).toBeInTheDocument();
    expect(screen.getByText("laptop")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));
    expect(onRevoke).toHaveBeenCalledWith("h1");
  });
  it("KeyList renders empty state vs rows", () => {
    const { rerender } = render(<KeyList keys={[]} onRevoke={() => {}} />);
    expect(screen.getByText(/no api keys yet/i)).toBeInTheDocument();
    rerender(<KeyList keys={[{ id: "h1", label: "laptop", prefix: "dl_ab12c" }]} onRevoke={() => {}} />);
    expect(screen.getByText("laptop")).toBeInTheDocument();
  });
});
