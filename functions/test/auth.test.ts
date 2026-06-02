import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractKey, isValidKey, requireWriteKey } from "../src/auth.js";

beforeEach(() => {
  process.env.DALOOP_WRITE_KEYS = "alpha,beta";
});

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

describe("isValidKey", () => {
  it("accepts a configured key and rejects others", () => {
    expect(isValidKey("alpha")).toBe(true);
    expect(isValidKey("beta")).toBe(true);
    expect(isValidKey("gamma")).toBe(false);
    expect(isValidKey(undefined)).toBe(false);
  });
});

describe("requireWriteKey middleware", () => {
  it("calls next() for a valid key", () => {
    const next = vi.fn();
    requireWriteKey({ headers: { authorization: "Bearer alpha" } } as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(); // no error
  });
  it("passes a 401 AppError for a missing/invalid key", () => {
    const next = vi.fn();
    requireWriteKey({ headers: {} } as any, {} as any, next);
    const err = next.mock.calls[0][0];
    expect(err.httpStatus).toBe(401);
    expect(err.code).toBe("unauthorized");
  });
});
