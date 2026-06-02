export function Spinner() {
  return (
    <p role="status" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--fg-soft)", fontSize: 13, padding: "var(--card-pad)" }}>
      <span className="spin" aria-hidden="true" />
      Loading…
    </p>
  );
}
