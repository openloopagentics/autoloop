/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" from a Firestore Timestamp or epoch ms. */
export function relativeTime(createdAt: unknown): string {
  const ms =
    createdAt && typeof (createdAt as { toMillis?: () => number }).toMillis === "function"
      ? (createdAt as { toMillis: () => number }).toMillis()
      : typeof createdAt === "number"
        ? createdAt
        : null;
  if (ms === null) return "";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
