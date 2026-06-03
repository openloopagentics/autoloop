import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../auth/context";
import { db } from "../firebase";
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

/**
 * Presentational waiting-room card. Holds no Firestore SDK — the request action
 * is injected via `onRequest(note)` so this can be unit-tested in isolation.
 */
export function RequestAccessCard({
  email, uid, status, error, onRequest, onSignOut,
}: {
  email: string;
  uid: string;
  status: string | null;
  error?: string | null;
  onRequest: (note: string) => void;
  onSignOut: () => void;
}) {
  const [note, setNote] = useState("");
  const canRequest = status === null || status === "denied";
  return (
    <div className="auth-stage">
      <div className="auth-card auth-card--access card">
        <div className="auth-lockup auth-lockup--sm">
          <LoopMark size={30} />
          <span className="wordmark serif" style={{ fontSize: 18 }}>daloop</span>
        </div>
        <span className="eyebrow" style={{ marginTop: 6 }}>Access pending</span>
        <h2 className="access-title serif">You're in the waiting room</h2>

        {status === "pending" ? (
          <p className="access-body">Request submitted — an admin will review it.</p>
        ) : status === "denied" ? (
          <p className="access-body">Your request was denied. Contact an admin, or request access again.</p>
        ) : (
          <p className="access-body">
            Your account isn't on the allowlist yet. Request access below and a Daloop admin will review it.
          </p>
        )}

        <div className="copyrows">
          <CopyRow label="Email" value={email} />
          <CopyRow label="User ID" value={uid} />
        </div>

        {canRequest && (
          <form
            className="grant-form"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}
            onSubmit={(e) => { e.preventDefault(); onRequest(note.trim()); }}
          >
            <textarea
              className="input"
              aria-label="Note"
              placeholder="Optional: a note for the admin"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn btn-sm" type="submit" style={{ alignSelf: "flex-start" }}>Request access</button>
          </form>
        )}

        {error && <p className="access-note" role="alert" style={{ color: "var(--st-cancelled)" }}>{error}</p>}

        <p className="access-note">This screen updates automatically once you're approved.</p>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

export function RequestAccess() {
  const { user, signOut } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, "accessRequests", user.uid),
      (snap) => { setStatus(snap.exists() ? (snap.data().status as string) : null); },
      (err) => { console.error("accessRequests listener:", err); },
    );
    return unsub;
  }, [user]);

  const onRequest = (note: string) => {
    if (!user) return;
    setError(null);
    void setDoc(doc(db, "accessRequests", user.uid), {
      uid: user.uid,
      email: user.email ?? "",
      note,
      status: "pending",
      requestedAt: serverTimestamp(),
    }).catch((e) => setError((e as Error).message ?? "Could not submit your request"));
  };

  return (
    <RequestAccessCard
      email={user?.email ?? ""}
      uid={user?.uid ?? ""}
      status={status}
      error={error}
      onRequest={onRequest}
      onSignOut={() => void signOut()}
    />
  );
}
