export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="err" style={{ padding: "10px 0" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12" y2="16.6" /></svg>
      {message}
    </p>
  );
}
