import { describe, it, expect } from "vitest";
import { parseBlockBody } from "./blockBody";

// These mirror the parseBlockBody fixtures in functions/test/vision-pages.test.ts,
// against the CLI parser this file ports (cli/vision-pages.mjs). The two must agree.
describe("parseBlockBody", () => {
  it("parses a JSON body", () => {
    expect(parseBlockBody('{"id":"x","threshold":80,"ok":true}')).toEqual({ id: "x", threshold: 80, ok: true });
  });

  it("parses a YAML body identically to its JSON twin", () => {
    const yaml = parseBlockBody('id: x\ntitle: "Login works"\nthreshold: 80\nok: true');
    const json = parseBlockBody('{"id":"x","title":"Login works","threshold":80,"ok":true}');
    expect(yaml).toEqual(json);
  });

  it("coerces true/42/quoted-string scalars", () => {
    const out = parseBlockBody('flag: true\ncount: 42\nname: "hi there"');
    expect(out).toEqual({ flag: true, count: 42, name: "hi there" });
  });

  it("throws on tab indentation", () => {
    expect(() => parseBlockBody("a:\n\tb: 1")).toThrow(/tabs not allowed/);
  });

  it("throws on odd (non-2-space) indentation", () => {
    expect(() => parseBlockBody("a:\n   b: 1")).toThrow(/indentation/);
  });

  it("throws on a line with no colon (not a key: value)", () => {
    expect(() => parseBlockBody("just a bare line")).toThrow(/key: value/);
  });

  it("throws on invalid inline JSON", () => {
    expect(() => parseBlockBody("val: { nope")).toThrow(/inline JSON/);
  });

  it("throws on block-style list-of-maps (use inline JSON instead)", () => {
    expect(() => parseBlockBody("items:\n  - id: x\n    name: X")).toThrow(/list-of-maps/);
  });

  it("yields {} for a bare key with no value and no children", () => {
    expect(parseBlockBody("a:")).toEqual({ a: {} });
  });

  it("parses inline-JSON list items", () => {
    expect(parseBlockBody("items:\n  - a\n  - { id: 1 }".replace("{ id: 1 }", '{"id":1}'))).toEqual({ items: ["a", { id: 1 }] });
  });

  it("returns {} for an empty body", () => {
    expect(parseBlockBody("")).toEqual({});
    expect(parseBlockBody("   \n  ")).toEqual({});
  });
});
