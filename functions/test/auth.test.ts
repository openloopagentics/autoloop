import { describe, it, expect } from "vitest";
import { extractKey } from "../src/auth.js";

describe("extractKey", () => {
  it("prefers Authorization Bearer over x-api-key", () => {
    expect(extractKey({ authorization: "Bearer alpha", "x-api-key": "beta" })).toBe("alpha");
  });
  it("falls back to x-api-key when no Authorization", () => {
    expect(extractKey({ "x-api-key": "beta" })).toBe("beta");
  });
  it("returns undefined when neither present", () => {
    expect(extractKey({})).toBeUndefined();
  });
});
