import { describe, it, expect } from "vitest";
import { teamIdFromName, slugify } from "./teamId";

const PATTERN = /^[a-z0-9._-]+$/;

describe("slugify", () => {
  it("lowercases, replaces invalid runs, trims, falls back to 'team'", () => {
    expect(slugify("Acme Web")).toBe("acme-web");
    expect(slugify("  --Hello.World--  ")).toBe("hello.world");
    expect(slugify("日本語")).toBe("team");
    expect(slugify("")).toBe("team");
  });
});

describe("teamIdFromName", () => {
  it("produces a non-empty id matching the pattern with a 4-char lowercase suffix", () => {
    const id = teamIdFromName("Acme Web", () => "k3f9");
    expect(id).toBe("acme-web-k3f9");
    expect(PATTERN.test(id)).toBe(true);
  });
  it("handles empty / non-ascii names → still valid", () => {
    expect(PATTERN.test(teamIdFromName("", () => "ab12"))).toBe(true);
    expect(teamIdFromName("日本語", () => "ab12")).toBe("team-ab12");
  });
});
