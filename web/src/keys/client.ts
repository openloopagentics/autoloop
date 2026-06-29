import { auth } from "../firebase";
import type { KeyMeta, MintedKey } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

async function headers(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
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

export async function mintKey(label: string): Promise<MintedKey> {
  const res = await fetch(`${BASE}/v1/keys`, { method: "POST", headers: await headers(), body: JSON.stringify({ label }) });
  return parse<MintedKey>(res);
}

export async function listKeys(): Promise<KeyMeta[]> {
  const res = await fetch(`${BASE}/v1/keys`, { headers: await headers() });
  return (await parse<{ keys: KeyMeta[] }>(res)).keys;
}

export async function revokeKey(id: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/keys/${id}`, { method: "DELETE", headers: await headers() });
  await parse<unknown>(res);
}
