import { useState } from "react";
export function TeamCreateForm({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); setName(""); }}>
      <label>Team name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button type="submit">Create team</button>
    </form>
  );
}
