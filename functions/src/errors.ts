import type { ErrorRequestHandler } from "express";

export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // body-parser errors (express.json) carry a `type` and HTTP `status` (400/413).
  // Treat malformed or oversized bodies as client validation errors, not 500s.
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { statusCode?: number }).statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(400).json({ error: { code: "validation", message: "request body too large or malformed" } });
    return;
  }
  // Avoid leaking internals.
  res.status(500).json({ error: { code: "internal", message: "internal error" } });
};
