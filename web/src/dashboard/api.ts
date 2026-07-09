import { auth } from "../firebase";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

async function headers(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function ok(res: Response): Promise<void> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = (await res.json())?.error?.message ?? message; } catch { /* ignore */ }
    throw new Error(message);
  }
}

function u(teamId: string, slug: string, rest = ""): string {
  return `${BASE}/v1/u/teams/${teamId}/projects/${slug}${rest}`;
}

export async function putProject(teamId: string, slug: string, body: { title: string; status?: string }): Promise<void> {
  await ok(await fetch(u(teamId, slug), { method: "PUT", headers: await headers(), body: JSON.stringify({ status: "running", ...body }) }));
}

export async function putGoal(teamId: string, slug: string, id: string, body: object): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/goals/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}

export async function deleteGoal(teamId: string, slug: string, id: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/goals/${id}`), { method: "DELETE", headers: await headers() }));
}

export async function putScenario(teamId: string, slug: string, id: string, body: object): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/scenarios/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}

export async function deleteScenario(teamId: string, slug: string, id: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/scenarios/${id}`), { method: "DELETE", headers: await headers() }));
}

export async function putDocument(teamId: string, slug: string, id: string, body: object): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/documents/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}

export async function deleteDocument(teamId: string, slug: string, id: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/documents/${id}`), { method: "DELETE", headers: await headers() }));
}

export async function putUserIdea(teamId: string, slug: string, id: string, body: object): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/ideas/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}

export async function postMessage(teamId: string, slug: string, text: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, "/messages"), { method: "POST", headers: await headers(), body: JSON.stringify({ text }) }));
}

export async function postComment(teamId: string, slug: string, body: { pageId: string; anchor: { exact: string; prefix: string; suffix: string }; body: string; severity: "advisory" | "blocking"; targetScenarioId?: string }): Promise<void> {
  await ok(await fetch(u(teamId, slug, "/comments"), { method: "POST", headers: await headers(), body: JSON.stringify(body) }));
}

export async function acceptComment(teamId: string, slug: string, id: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/comments/${id}/accept`), { method: "POST", headers: await headers() }));
}

export async function deleteProject(teamId: string, slug: string): Promise<void> {
  await ok(await fetch(u(teamId, slug), { method: "DELETE", headers: await headers() }));
}

export async function rejectVisionChange(teamId: string, slug: string, changeId: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/vision-changes/${changeId}/reject`), { method: "POST", headers: await headers() }));
}
