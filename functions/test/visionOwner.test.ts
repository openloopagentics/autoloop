import { describe, it, expect } from "vitest";
import { assertWebEditable } from "../src/services/visionOwner.js";
import { AppError } from "../src/errors.js";

function snap(exists: boolean, data?: Record<string, unknown>) {
  return { exists, data: () => data } as unknown as FirebaseFirestore.DocumentSnapshot;
}

describe("assertWebEditable", () => {
  it("throws 404 when the project is missing", () => {
    try { assertWebEditable(snap(false)); throw new Error("no throw"); }
    catch (e) { expect((e as AppError).httpStatus).toBe(404); }
  });
  it("throws 409 when visionOwner === 'loop'", () => {
    try { assertWebEditable(snap(true, { visionOwner: "loop" })); throw new Error("no throw"); }
    catch (e) { expect((e as AppError).httpStatus).toBe(409); }
  });
  it("passes when visionOwner is 'web' or absent", () => {
    expect(() => assertWebEditable(snap(true, { visionOwner: "web" }))).not.toThrow();
    expect(() => assertWebEditable(snap(true, {}))).not.toThrow();
  });
});
