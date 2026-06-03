import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthValue } from "../auth/context";
import { SignIn } from "./SignIn";
import { RequestAccessCard } from "./RequestAccess";
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

describe("RequestAccessCard", () => {
  it("shows the user's email and uid", () => {
    render(<RequestAccessCard email="p@x.com" uid="abc123" status={null} onRequest={() => {}} onSignOut={() => {}} />);
    expect(screen.getByText(/p@x.com/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });
  it("shows a Request access button when there is no request and emits the note", async () => {
    const onRequest = vi.fn();
    render(<RequestAccessCard email="p@x.com" uid="u1" status={null} onRequest={onRequest} onSignOut={() => {}} />);
    await userEvent.type(screen.getByLabelText(/note/i), "let me in");
    await userEvent.click(screen.getByRole("button", { name: /request access/i }));
    expect(onRequest).toHaveBeenCalledWith("let me in");
  });
  it("shows a pending message and no request button once submitted", () => {
    render(<RequestAccessCard email="p@x.com" uid="u1" status="pending" onRequest={() => {}} onSignOut={() => {}} />);
    expect(screen.getByText(/review it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /request access/i })).toBeNull();
  });
  it("allows re-requesting after a denial", () => {
    render(<RequestAccessCard email="p@x.com" uid="u1" status="denied" onRequest={() => {}} onSignOut={() => {}} />);
    expect(screen.getByText(/denied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /request access/i })).toBeInTheDocument();
  });
});

describe("AppShell", () => {
  it("renders nav + a Getting started link", () => {
    withAuth({}, <AppShell />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /getting started/i }).length).toBeGreaterThan(0);
  });

  it("profile menu reveals the email and Sign out calls signOut", async () => {
    const signOut = vi.fn();
    withAuth({ signOut }, <AppShell />);
    // email + sign out live inside the profile dropdown, hidden until opened
    expect(screen.queryByText("u@x.com")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
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
