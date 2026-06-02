import { useState } from "react";
export function TeamCreateForm({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form className="invite-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); setName(""); }}>
      <input className="input" aria-label="Team name" placeholder="Team name"
        value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn btn-sm" type="submit" disabled={!name.trim()}>Create team</button>
    </form>
  );
}
