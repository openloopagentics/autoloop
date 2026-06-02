import { useState } from "react";
import { useAuth } from "../auth/context";
import { LoopMark } from "../ui/LoopMark";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { void navigator.clipboard?.writeText(value); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="copyrow">
      <span className="copyrow-label">{label}</span>
      <code className="copyrow-val mono">{value}</code>
      <button className="copyrow-btn" aria-label={`Copy ${label}`} onClick={copy}>
        {copied
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 12.5 10 18 20 6" /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
      </button>
    </div>
  );
}

export function RequestAccess() {
  const { user, signOut } = useAuth();
  return (
    <div className="auth-stage">
      <div className="auth-card auth-card--access card">
        <div className="auth-lockup auth-lockup--sm">
          <LoopMark size={30} />
          <span className="wordmark serif" style={{ fontSize: 18 }}>daloop</span>
        </div>
        <span className="eyebrow" style={{ marginTop: 6 }}>Access pending</span>
        <h2 className="access-title serif">You're in the waiting room</h2>
        <p className="access-body">
          Your account isn't on the allowlist yet. Ask a Daloop admin to grant you access —
          they'll need your <strong>User ID</strong> below.
        </p>
        <div className="copyrows">
          <CopyRow label="Email" value={user?.email ?? ""} />
          <CopyRow label="User ID" value={user?.uid ?? ""} />
        </div>
        <p className="access-note">This screen updates automatically once you're approved.</p>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}
