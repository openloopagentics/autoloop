import { useState } from "react";
export function GrantByUidForm({ onGrant }: { onGrant: (uid: string, email: string) => void }) {
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form className="grant-form" onSubmit={(e) => { e.preventDefault(); if (uid.trim()) onGrant(uid.trim(), email.trim()); setUid(""); setEmail(""); }}>
      <input className="input" aria-label="UID" placeholder="User ID" value={uid} onChange={(e) => setUid(e.target.value)} />
      <input className="input" aria-label="Email" placeholder="email@domain.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn btn-sm" type="submit">Grant access</button>
    </form>
  );
}
