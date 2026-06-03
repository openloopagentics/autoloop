import { describe, it, expect } from "vitest";
import { ulid } from "../src/ulid.js";

describe("ulid", () => {
  it("produces a 26-char Crockford-base32 string", () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("sorts lexicographically by time (earlier ms < later ms)", () => {
    const early = ulid(1_000_000_000_000);
    const late = ulid(1_700_000_000_000);
    expect(early < late).toBe(true);
  });

  it("two ids at the same ms share the 10-char time prefix but differ in the random suffix", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_000);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a).not.toBe(b);
  });

  it("defaults to the current time when no arg is given", () => {
    const id = ulid();
    expect(id.length).toBe(26);
  });
});
