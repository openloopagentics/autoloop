import { vi } from "vitest";
vi.mock("./dashboard/hooks", () => ({
  useMyTeams: () => ({ data: [], loading: false, error: null }),
  useTeam: () => ({ data: null, loading: false, error: null }),
  useTeamProjects: () => ({ data: [], loading: false, error: null }),
  useProject: () => ({ data: null, loading: false, error: null }),
  usePhases: () => ({ data: [], loading: false, error: null }),
  useCommits: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("./teams/hooks", () => ({
  useTeamMembers: () => ({ data: [], loading: false, error: null }),
  useTeamInvites: () => ({ data: [], loading: false, error: null }),
  useMyPendingInvites: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("./teams/actions", () => ({
  createTeam: vi.fn(), inviteMember: vi.fn(), revokeInvite: vi.fn(), acceptInvite: vi.fn(),
  declineInvite: vi.fn(), changeRole: vi.fn(), removeMember: vi.fn(),
}));
vi.mock("./keys/client", () => ({
  mintKey: vi.fn(),
  listKeys: () => Promise.resolve([]),
  revokeKey: vi.fn(),
}));

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthContext, type AuthValue } from "./auth/context";
import { App } from "./App";

function renderState(partial: Partial<AuthValue>) {
  const value: AuthValue = {
    state: "loading", user: null, isAllowed: false,
    signIn: async () => {}, signOut: async () => {}, signInError: null, ...partial,
  };
  return render(<AuthContext.Provider value={value}><App /></AuthContext.Provider>);
}

describe("App gate", () => {
  it("loading -> spinner", () => {
    renderState({ state: "loading" });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("signed-out -> SignIn", () => {
    renderState({ state: "signed-out" });
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
  it("pending -> RequestAccess with email+uid", () => {
    renderState({ state: "pending", user: { uid: "abc123", email: "p@x.com" } });
    expect(screen.getByText(/p@x.com/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });
  it("allowed -> AppShell with Dashboard nav link", () => {
    renderState({ state: "allowed", user: { uid: "u1", email: "u@x.com" }, isAllowed: true });
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });
});
