import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteRow } from "./InviteRow";
import { PendingInviteRow } from "./PendingInviteRow";
import type { Invite } from "../types";

const inv: Invite = { id: "i1", teamId: "t1", email: "p@x.com", role: "member" };

describe("InviteRow", () => {
  it("shows email+role and revokes", async () => {
    const onRevoke = vi.fn();
    render(<InviteRow invite={inv} onRevoke={onRevoke} />);
    expect(screen.getByText(/p@x.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));
    expect(onRevoke).toHaveBeenCalledWith(inv);
  });
});

describe("PendingInviteRow", () => {
  it("accept and decline emit the invite", async () => {
    const onAccept = vi.fn(), onDecline = vi.fn();
    render(<PendingInviteRow invite={inv} onAccept={onAccept} onDecline={onDecline} />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(onAccept).toHaveBeenCalledWith(inv);
    expect(onDecline).toHaveBeenCalledWith(inv);
  });
});
