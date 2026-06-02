import { describe, it, expect } from "vitest";
import { deriveAccess } from "./gate";

const u = { uid: "u1", email: "u@x.com" };

describe("deriveAccess", () => {
  it("loading until auth resolves", () => {
    expect(deriveAccess({ authResolved: false, user: null, userDocResolved: false, isAllowed: false })).toBe("loading");
  });
  it("signed-out when auth resolved and no user", () => {
    expect(deriveAccess({ authResolved: true, user: null, userDocResolved: false, isAllowed: false })).toBe("signed-out");
  });
  it("loading while the user doc is not yet resolved (flash-prevention)", () => {
    expect(deriveAccess({ authResolved: true, user: u, userDocResolved: false, isAllowed: false })).toBe("loading");
  });
  it("allowed when user doc resolved and isAllowed", () => {
    expect(deriveAccess({ authResolved: true, user: u, userDocResolved: true, isAllowed: true })).toBe("allowed");
  });
  it("pending when user doc resolved but not allowed (missing or false)", () => {
    expect(deriveAccess({ authResolved: true, user: u, userDocResolved: true, isAllowed: false })).toBe("pending");
  });
});
