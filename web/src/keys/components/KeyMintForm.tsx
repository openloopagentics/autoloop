import { useState } from "react";
export function KeyMintForm({ onMint, pending }: { onMint: (label: string) => void; pending: boolean }) {
  const [label, setLabel] = useState("");
  return (
    <form className="invite-form" onSubmit={(e) => { e.preventDefault(); if (label.trim()) onMint(label.trim()); setLabel(""); }}>
      <input className="input" aria-label="Key label" placeholder="Label — e.g. atlas-ci"
        value={label} onChange={(e) => setLabel(e.target.value)} />
      <button className="btn btn-sm" type="submit" disabled={pending || !label.trim()}>Create key</button>
    </form>
  );
}
