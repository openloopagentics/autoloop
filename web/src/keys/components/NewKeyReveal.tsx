export function NewKeyReveal({ keyValue, onDismiss }: { keyValue: string; onDismiss: () => void }) {
  return (
    <div role="dialog" aria-label="New API key" className="reveal card fade-up">
      <div className="reveal-head">
        <span className="eyebrow" style={{ color: "var(--brand)" }}>New key</span>
        <button className="copyrow-btn" onClick={onDismiss} aria-label="Dismiss">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
      <p className="reveal-warn">Copy it now — you won't be able to see this key again.</p>
      <div className="reveal-key">
        <code className="reveal-val mono">{keyValue}</code>
        <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(keyValue)}>Copy</button>
      </div>
    </div>
  );
}
