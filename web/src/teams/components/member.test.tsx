import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberRow } from "./MemberRow";
import type { Member } from "../types";

const carol: Member = { uid: "carol", role: "member", email: "c@x.com" };
const adam: Member = { uid: "adam", role: "admin", email: "a@x.com" };
const alice: Member = { uid: "alice", role: "owner", email: "al@x.com" };
const noop = { onChangeRole: vi.fn(), onRemove: vi.fn() };

function row(member: Member, viewerRole: "owner"|"admin"|"member", selfUid: string) {
  render(<MemberRow member={member} viewerRole={viewerRole} selfUid={selfUid} {...noop} />);
}

describe("MemberRow gating", () => {
  it("owner viewer sees role select + remove on a non-self member", () => {
    row(carol, "owner", "alice");
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });
  it("admin viewer sees controls on a member row only", () => {
    row(carol, "admin", "adam");
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
  it("admin viewer sees NO controls on an owner or admin row", () => {
    const { unmount } = render(<MemberRow member={alice} viewerRole="admin" selfUid="adam" {...noop} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    unmount();
    render(<MemberRow member={adam} viewerRole="admin" selfUid="other" {...noop} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("own row shows Leave", () => {
    row(adam, "admin", "adam");
    expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument();
  });
  it("member viewer sees no controls", () => {
    row(alice, "member", "carol");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
