import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamCreateForm } from "./TeamCreateForm";
import { InviteForm } from "./InviteForm";

describe("TeamCreateForm", () => {
  it("submits the typed name", async () => {
    const onCreate = vi.fn();
    render(<TeamCreateForm onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText(/team name/i), "Acme");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(onCreate).toHaveBeenCalledWith("Acme");
  });
});

describe("InviteForm", () => {
  it("submits email + role", async () => {
    const onInvite = vi.fn();
    render(<InviteForm onInvite={onInvite} />);
    await userEvent.type(screen.getByLabelText(/email/i), "p@x.com");
    await userEvent.selectOptions(screen.getByLabelText(/role/i), "admin");
    await userEvent.click(screen.getByRole("button", { name: /invite/i }));
    expect(onInvite).toHaveBeenCalledWith("p@x.com", "admin");
  });
});
