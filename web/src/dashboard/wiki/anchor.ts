/**
 * Text anchors for steering comments. A comment "sticks" to a selected span of a
 * wiki page even after the loop rewrites the page around it: we store the exact
 * selected text plus a bounded window of surrounding context, then re-locate on
 * the (possibly edited) page. When the exact text appears more than once, the
 * context window disambiguates; when it's gone entirely, the anchor orphans (null).
 */

const CONTEXT = 64;

export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
}

/**
 * Build an anchor from a selection [start, end) inside `pageText`. `exact` is the
 * selected text; `prefix`/`suffix` are up to CONTEXT chars of surrounding context.
 * Throws on an empty or inverted selection — a collapsed range can't be anchored.
 */
export function makeAnchor(pageText: string, start: number, end: number): Anchor {
  if (end <= start) throw new Error("Cannot anchor an empty selection");
  return {
    exact: pageText.slice(start, end),
    prefix: pageText.slice(Math.max(0, start - CONTEXT), start),
    suffix: pageText.slice(end, end + CONTEXT),
  };
}

/** Length of the shared suffix of `a` and `b` (how many trailing chars match). */
function sharedSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Length of the shared prefix of `a` and `b` (how many leading chars match). */
function sharedPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Locate the anchor in `pageText`. A single occurrence of `exact` wins outright.
 * With several occurrences, score each by how much of the stored prefix/suffix
 * context still surrounds it and take the best (ties keep the earliest). No
 * occurrence → null (the anchor has orphaned; the page dropped the passage).
 */
export function locateAnchor(pageText: string, a: Anchor): { start: number; end: number } | null {
  if (!a.exact) return null;

  const occurrences: number[] = [];
  for (let i = pageText.indexOf(a.exact); i !== -1; i = pageText.indexOf(a.exact, i + 1)) {
    occurrences.push(i);
  }
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) {
    return { start: occurrences[0], end: occurrences[0] + a.exact.length };
  }

  let best = occurrences[0];
  let bestScore = -1;
  for (const start of occurrences) {
    const before = pageText.slice(Math.max(0, start - a.prefix.length), start);
    const after = pageText.slice(start + a.exact.length, start + a.exact.length + a.suffix.length);
    const score = sharedSuffixLen(before, a.prefix) + sharedPrefixLen(after, a.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return { start: best, end: best + a.exact.length };
}
