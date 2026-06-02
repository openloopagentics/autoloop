import { describe, it, expect, vi } from "vitest";
import { AppError, errorHandler } from "../src/errors.js";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("AppError + errorHandler", () => {
  it("renders an AppError as its status + envelope", () => {
    const res = mockRes();
    errorHandler(new AppError(404, "not_found", "no such project"), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "not_found", message: "no such project" } });
  });

  it("renders unknown errors as 500", () => {
    const res = mockRes();
    errorHandler(new Error("boom"), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "internal", message: "internal error" } });
  });

  it("maps body-parser errors (oversized/malformed JSON) to 400", () => {
    const res = mockRes();
    const tooLarge: any = new Error("request entity too large");
    tooLarge.type = "entity.too.large";
    tooLarge.status = 413;
    errorHandler(tooLarge, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "validation", message: "request body too large or malformed" } });
  });
});
