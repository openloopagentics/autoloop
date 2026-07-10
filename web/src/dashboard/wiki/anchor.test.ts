import { describe, it, expect } from "vitest";
import { makeAnchor, locateAnchor } from "./anchor";

const text =
  "The login flow must reject bad passwords. " +
  "Users can log in with valid credentials. " +
  "The login flow must reject bad passwords again.";

describe("makeAnchor", () => {
  it("captures the exact selection and bounded context", () => {
    const start = text.indexOf("valid credentials");
    const end = start + "valid credentials".length;
    const a = makeAnchor(text, start, end);
    expect(a.exact).toBe("valid credentials");
    expect(text.endsWith(a.suffix) || text.includes(a.suffix)).toBe(true);
    expect(a.prefix.length).toBeLessThanOrEqual(64);
    expect(a.suffix.length).toBeLessThanOrEqual(64);
    // Prefix is the text immediately before the selection.
    expect(text.slice(0, start).endsWith(a.prefix)).toBe(true);
    // Suffix is the text immediately after.
    expect(text.slice(end).startsWith(a.suffix)).toBe(true);
  });

  it("rejects a collapsed selection (start === end)", () => {
    expect(() => makeAnchor(text, 5, 5)).toThrow();
  });

  it("rejects an inverted selection (end < start)", () => {
    expect(() => makeAnchor(text, 10, 5)).toThrow();
  });
});

describe("locateAnchor", () => {
  it("round-trips make → locate on unedited text", () => {
    const start = text.indexOf("valid credentials");
    const end = start + "valid credentials".length;
    const a = makeAnchor(text, start, end);
    expect(locateAnchor(text, a)).toEqual({ start, end });
  });

  it("still locates when text is edited elsewhere", () => {
    const start = text.indexOf("valid credentials");
    const end = start + "valid credentials".length;
    const a = makeAnchor(text, start, end);
    const edited = "A brand new intro sentence. " + text.replace("again.", "one more time.");
    const loc = locateAnchor(edited, a);
    expect(loc).not.toBeNull();
    expect(edited.slice(loc!.start, loc!.end)).toBe("valid credentials");
  });

  it("disambiguates duplicated exact text via prefix/suffix (picks the RIGHT occurrence)", () => {
    // "the login flow must reject bad passwords" appears twice. Anchor the SECOND one.
    const phrase = "The login flow must reject bad passwords";
    const second = text.lastIndexOf(phrase);
    const a = makeAnchor(text, second, second + phrase.length);
    const loc = locateAnchor(text, a);
    expect(loc).toEqual({ start: second, end: second + phrase.length });
    // Sanity: it's NOT the first occurrence.
    expect(loc!.start).not.toBe(text.indexOf(phrase));
  });

  it("returns null for a deleted passage (orphaned)", () => {
    const start = text.indexOf("valid credentials");
    const end = start + "valid credentials".length;
    const a = makeAnchor(text, start, end);
    const edited = text.replace("Users can log in with valid credentials. ", "");
    expect(locateAnchor(edited, a)).toBeNull();
  });

  it("breaks a tie of equal context scores toward the earliest occurrence", () => {
    // "xx" appears twice with symmetric surroundings; with no distinguishing context
    // (empty prefix/suffix) both score 0 — the earliest must win deterministically.
    const t = "a xx b xx c";
    const a = { exact: "xx", prefix: "", suffix: "" };
    expect(locateAnchor(t, a)).toEqual({ start: t.indexOf("xx"), end: t.indexOf("xx") + 2 });
  });

  it("anchors a selection at position 0 (start of text)", () => {
    const a = makeAnchor(text, 0, 3);
    expect(a.exact).toBe("The");
    expect(a.prefix).toBe("");
    expect(locateAnchor(text, a)).toEqual({ start: 0, end: 3 });
  });

  it("anchors a selection at the very end of text", () => {
    const a = makeAnchor(text, text.length - 6, text.length);
    expect(a.exact).toBe("again.");
    expect(a.suffix).toBe("");
    expect(locateAnchor(text, a)).toEqual({ start: text.length - 6, end: text.length });
  });
});
