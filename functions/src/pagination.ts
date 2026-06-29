// Hard caps for list endpoints so an unbounded collection can't blow the
// response/size budget. Callers may request fewer via ?limit=, never more.

/** Default hard cap on the number of docs a list endpoint will read/return. */
export const MAX_LIST_LIMIT = 500;

/** Parse a ?limit= query value (string | string[] | undefined) into a number, or undefined. */
export function parseLimitParam(v: unknown): number | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Clamp an optional requested limit to [1, max]; default to max when absent/invalid. */
export function clampLimit(requested: number | undefined, max = MAX_LIST_LIMIT): number {
  if (typeof requested === "number" && Number.isFinite(requested) && requested > 0) {
    return Math.min(Math.floor(requested), max);
  }
  return max;
}
