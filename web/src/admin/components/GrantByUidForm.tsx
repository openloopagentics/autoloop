import { useState } from "react";
export function GrantByUidForm({ onGrant }: { onGrant: (uid: string, email: string) => void }) {
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (uid.trim()) onGrant(uid.trim(), email.trim()); setUid(""); setEmail(""); }}>
      <label>UID <input value={uid} onChange={(e) => setUid(e.target.value)} /></label>
      <label>Email <input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <button type="submit">Grant access</button>
    </form>
  );
}
