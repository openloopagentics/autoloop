import { useState } from "react";
import type { Role } from "../types";
export function InviteForm({ onInvite }: { onInvite: (email: string, role: Role) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  return (
    <form className="invite-form" onSubmit={(e) => { e.preventDefault(); if (email.trim()) onInvite(email.trim(), role); setEmail(""); }}>
      <input className="input" type="email" aria-label="Email" placeholder="teammate@email.com"
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <select className="select select-sm" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="member">member</option>
        <option value="admin">admin</option>
        <option value="owner">owner</option>
      </select>
      <button className="btn btn-sm" type="submit">Invite</button>
    </form>
  );
}
