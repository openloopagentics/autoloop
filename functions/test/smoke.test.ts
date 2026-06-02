import { describe, it, expect } from "vitest";
import { ping } from "../src/index.js";

describe("smoke", () => {
  it("toolchain runs", () => {
    expect(ping()).toBe("ok");
  });
});
