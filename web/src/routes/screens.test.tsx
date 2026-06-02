import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthValue } from "../auth/context";
import { SignIn } from "./SignIn";
import { RequestAccess } from "./RequestAccess";
import { AppShell } from "./AppShell";

function withAuth(partial: Partial<AuthValue>, node: React.ReactNode) {
  const value: AuthValue = {
    state: "allowed", user: { uid: "u1", email: "u@x.com" }, isAllowed: true,
    signIn: async () => {}, signOut: async () => {}, signInError: null, ...partial,
  };
  return render(<AuthContext.Provider value={value}><MemoryRouter>{node}</MemoryRouter></AuthContext.Provider>);
}

describe("SignIn", () => {
  it("calls signIn on click and shows an error when present", async () => {
    const signIn = vi.fn();
    withAuth({ signIn, signInError: "popup blocked" }, <SignIn />);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(signIn).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("popup blocked");
  });
});

describe("RequestAccess", () => {
  it("shows the user's email and uid", () => {
    withAuth({ user: { uid: "abc123", email: "p@x.com" } }, <RequestAccess />);
    expect(screen.getByText(/p@x.com/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });
});

describe("AppShell", () => {
  it("renders nav + email and Sign out calls signOut", async () => {
    const signOut = vi.fn();
    withAuth({ signOut }, <AppShell />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText("u@x.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  it("AppShell shows the Admin link only when isAdmin", async () => {
    withAuth({ isAdmin: false }, <AppShell />);
    expect(screen.queryByRole("link", { name: /admin/i })).toBeNull();
    // re-render as admin
    cleanup();
    withAuth({ isAdmin: true }, <AppShell />);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });
});
