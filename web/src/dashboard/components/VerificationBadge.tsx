import type { VerificationVerdict } from "../verificationView";

const LABELS = {
  confirmed: { cls: "confirmed", title: "Independently verified",                full: "✓ Verified", glyph: "✓" },
  refuted:   { cls: "refuted",   title: "Independent replay refuted this result", full: "✗ Refuted",  glyph: "✗" },
} as const;

/** Verification badge layer (evidence, not a gate — met-state is untouched).
 *  compact: glyph-only (scenario card/table). showUnverified: render ⚠ Unverified
 *  when there is no verdict (scenario level); test-run rows render nothing instead. */
export function VerificationBadge({ verdict, compact = false, showUnverified = false }: {
  verdict: VerificationVerdict | undefined; compact?: boolean; showUnverified?: boolean;
}) {
  if (!verdict) {
    if (!showUnverified) return null;
    return <span className="verifybadge verifybadge--unverified" role="img" aria-label="Not independently verified" title="Not independently verified">⚠ Unverified</span>;
  }
  const l = LABELS[verdict];
  return <span className={`verifybadge verifybadge--${l.cls}`} role="img" aria-label={l.title} title={l.title}>{compact ? l.glyph : l.full}</span>;
}
