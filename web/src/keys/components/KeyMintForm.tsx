import { useState } from "react";
export function KeyMintForm({ onMint, pending }: { onMint: (label: string) => void; pending: boolean }) {
  const [label, setLabel] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (label.trim()) onMint(label.trim()); setLabel(""); }}>
      <label>Key label <input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <button type="submit" disabled={pending}>Create key</button>
    </form>
  );
}
