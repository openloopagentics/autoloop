export function NewKeyReveal({ keyValue, onDismiss }: { keyValue: string; onDismiss: () => void }) {
  return (
    <div role="dialog" className="key-reveal">
      <p><strong>Copy your new key now — it won't be shown again.</strong></p>
      <code>{keyValue}</code>
      <button onClick={() => void navigator.clipboard?.writeText(keyValue)}>Copy</button>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
