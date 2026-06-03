import { auth } from "../firebase";
import type { AdminUser, AccessRequest } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function headers(): Promise<HeadersInit> {
  const token = await auth.currentUser!.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = (await res.json())?.error?.message ?? message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
export async function listUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${BASE}/v1/admin/users`, { headers: await headers() });
  return (await parse<{ users: AdminUser[] }>(res)).users;
}
export async function setAllowed(uid: string, isAllowed: boolean, email?: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/admin/users/${uid}`, {
    method: "PUT", headers: await headers(),
    body: JSON.stringify(email ? { isAllowed, email } : { isAllowed }),
  });
  await parse<unknown>(res);
}
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const res = await fetch(`${BASE}/v1/admin/access-requests`, { headers: await headers() });
  return (await parse<{ requests: AccessRequest[] }>(res)).requests;
}
export async function decideAccessRequest(uid: string, decision: "approve" | "deny"): Promise<void> {
  const res = await fetch(`${BASE}/v1/admin/access-requests/${uid}`, {
    method: "POST", headers: await headers(), body: JSON.stringify({ decision }),
  });
  await parse<unknown>(res);
}
