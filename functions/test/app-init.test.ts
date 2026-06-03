import { describe, it, expect } from "vitest";
import { getApps, deleteApp } from "firebase-admin/app";
import { makeApp } from "../src/app.js";

// Regression: the ID-token auth middleware calls getAuth().verifyIdToken()
// BEFORE any db() call. If the default Admin app isn't initialized at app
// construction, getAuth() throws on a cold instance whose first request is
// ID-token-gated (GET /v1/keys, /v1/admin) → swallowed into a 401
// "invalid ID token". makeApp() must initialize the app up front.
describe("Admin app initialization", () => {
  it("makeApp() initializes the default Firebase app before any request", async () => {
    // Tear down any app a prior import created, to simulate a cold instance.
    await Promise.all(getApps().map((a) => deleteApp(a)));
    expect(getApps().length).toBe(0);

    makeApp();

    expect(getApps().length).toBeGreaterThan(0);
  });
});
