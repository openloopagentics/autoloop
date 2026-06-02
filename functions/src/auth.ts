import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "./errors.js";

type Headers = Record<string, string | string[] | undefined>;

export function extractKey(headers: Headers): string | undefined {
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const xKey = headers["x-api-key"];
  if (typeof xKey === "string" && xKey.length > 0) return xKey;
  return undefined;
}

function configuredKeys(): string[] {
  return (process.env.DALOOP_WRITE_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison to avoid early-exit timing signal, then return false.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function isValidKey(key: string | undefined): boolean {
  if (!key) return false;
  // Check every key without early exit.
  let ok = false;
  for (const k of configuredKeys()) {
    if (constantTimeEquals(key, k)) ok = true;
  }
  return ok;
}

export const requireWriteKey: RequestHandler = (req, _res, next) => {
  const key = extractKey(req.headers as Headers);
  if (!isValidKey(key)) {
    next(new AppError(401, "unauthorized", "missing or invalid API key"));
    return;
  }
  next();
};
