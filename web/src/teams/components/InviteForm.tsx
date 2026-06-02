import { useState } from "react";
import type { Role } from "../types";
export function InviteForm({ onInvite }: { onInvite: (email: string, role: Role) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) onInvite(email.trim(), role); setEmail(""); }}>
      <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="member">member</option>
          <option value="admin">admin</option>
          <option value="owner">owner</option>
        </select>
      </label>
      <button type="submit">Invite</button>
    </form>
  );
}
