import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserRow } from "./UserRow";
import { UserList } from "./UserList";
import { GrantByUidForm } from "./GrantByUidForm";
import { AccessRequests } from "./AccessRequests";

describe("UserRow", () => {
  it("shows email or uid; Allow on a disallowed user emits true", async () => {
    const onSet = vi.fn();
    render(<UserRow user={{ uid: "u1", email: "e@x.com", isAllowed: false, isAdmin: false }} onSetAllowed={onSet} />);
    expect(screen.getByText(/e@x.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /allow/i }));
    expect(onSet).toHaveBeenCalledWith("u1", true);
  });
  it("falls back to uid; Revoke on an allowed user emits false", async () => {
    const onSet = vi.fn();
    render(<UserRow user={{ uid: "u2", isAllowed: true, isAdmin: true }} onSetAllowed={onSet} />);
    expect(screen.getByText(/u2/)).toBeInTheDocument();
    expect(screen.getByText(/admin/i)).toBeInTheDocument(); // admin badge
    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));
    expect(onSet).toHaveBeenCalledWith("u2", false);
  });
});

describe("UserList", () => {
  it("empty vs populated", () => {
    const { rerender } = render(<UserList users={[]} onSetAllowed={() => {}} />);
    expect(screen.getByText(/no users/i)).toBeInTheDocument();
    rerender(<UserList users={[{ uid: "u1", isAllowed: true, isAdmin: false }]} onSetAllowed={() => {}} />);
    expect(screen.getByText(/u1/)).toBeInTheDocument();
  });
});

describe("GrantByUidForm", () => {
  it("emits uid + email", async () => {
    const onGrant = vi.fn();
    render(<GrantByUidForm onGrant={onGrant} />);
    await userEvent.type(screen.getByLabelText(/uid/i), "NewUid");
    await userEvent.type(screen.getByLabelText(/email/i), "n@x.com");
    await userEvent.click(screen.getByRole("button", { name: /grant/i }));
    expect(onGrant).toHaveBeenCalledWith("NewUid", "n@x.com");
  });
});

describe("AccessRequests", () => {
  it("empty vs populated; Approve/Deny emit the uid", async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const { rerender } = render(<AccessRequests requests={[]} onApprove={onApprove} onDeny={onDeny} />);
    expect(screen.getByText(/no pending requests/i)).toBeInTheDocument();
    rerender(
      <AccessRequests
        requests={[{ uid: "u1", email: "u1@x.com", note: "please", status: "pending" }]}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    expect(screen.getByText(/u1@x.com/)).toBeInTheDocument();
    expect(screen.getByText(/please/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("u1");
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onDeny).toHaveBeenCalledWith("u1");
  });
});
