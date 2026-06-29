import type { RequestHandler } from "express";
import { AppError } from "./errors.js";
import { extractKey } from "./auth.js";
import { hashKey } from "./apiKeys.js";

// Per-instance, BEST-EFFORT rate limiting for the agent write path.
// Cloud Functions reuses warm instances, so an in-memory counter throttles
// bursts from a single key on a given instance. It is NOT a global guarantee:
// requests spread across multiple instances each get their own budget. Treat
// this as a cheap first layer of abuse protection, not a hard quota.

/** Max requests allowed per key within one window. */
export const RATE_LIMIT_MAX = 120;
/** Fixed window length in milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

// Lazily drop windows that have fully elapsed so the map can't grow without
// bound from one-off keys. Runs at most once per window.
function sweep(now: number): void {
  if (now - lastSweep < RATE_LIMIT_WINDOW_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Test hook: clear all in-memory counters. */
export function resetRateLimiter(): void { buckets.clear(); lastSweep = 0; }

/**
 * Throttle by the presented API key (hashed). Mounted BEFORE requireApiKeyMember
 * so abusive bursts are rejected before any Firestore auth read. Requests with no
 * key fall through untouched — the auth middleware returns 401.
 */
export const rateLimit: RequestHandler = (req, res, next) => {
  const key = extractKey(req.headers as Record<string, string | string[] | undefined>);
  if (!key) { next(); return; }
  const id = hashKey(key);
  const now = Date.now();
  sweep(now);
  let b = buckets.get(id);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }; buckets.set(id, b); }
  b.count++;
  if (b.count > RATE_LIMIT_MAX) {
    res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
    next(new AppError(429, "rate_limited", "too many requests; slow down"));
    return;
  }
  next();
};
