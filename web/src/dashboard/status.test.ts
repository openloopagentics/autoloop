import { describe, it, expect } from "vitest";
import { statusColor } from "./status";

describe("statusColor", () => {
  it("maps each status to a color class", () => {
    expect(statusColor("queued")).toBe("gray");
    expect(statusColor("running")).toBe("blue");
    expect(statusColor("blocked")).toBe("red");
    expect(statusColor("paused")).toBe("amber");
    expect(statusColor("completed")).toBe("green");
    expect(statusColor("failed")).toBe("red");
    expect(statusColor("cancelled")).toBe("gray");
  });
  it("defaults to gray for an unknown status", () => {
    expect(statusColor("???")).toBe("gray");
  });
});
