import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthContext, useAuth, type AuthValue } from "./context";

function Probe() {
  const { state, user } = useAuth();
  return <div>{state}:{user?.email ?? "none"}</div>;
}

const value: AuthValue = {
  state: "allowed", user: { uid: "u1", email: "u@x.com" }, isAllowed: true,
  signIn: async () => {}, signOut: async () => {}, signInError: null,
};

describe("useAuth", () => {
  it("reads the provided context value", () => {
    render(<AuthContext.Provider value={value}><Probe /></AuthContext.Provider>);
    expect(screen.getByText("allowed:u@x.com")).toBeInTheDocument();
  });
  it("throws when used outside a provider", () => {
    expect(() => render(<Probe />)).toThrow(/useAuth must be used within/);
  });
});
