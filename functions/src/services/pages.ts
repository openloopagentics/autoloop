import { FieldValue } from "firebase-admin/firestore";
import { resolveBase } from "./baseRef.js";
import type { PageBody } from "../schemas.js";

// Pages are ALWAYS loop-owned by design — the loop authors the wiki and the CLI syncs it
// up. There is no web write path, so no assertWebEditable guard here (unlike documents).
// Project-direct only (no loopId variant): a page belongs to the project, not a single loop.

/** Upsert a wiki page (idempotent PUT). Full-document write — the CLI always sends every field. */
export async function upsertPage(teamId: string, slug: string, pageId: string, body: PageBody): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug); // project-level (404s on a missing project)
  const ref = baseRef.collection("pages").doc(pageId);
  await ref.set({
    path: body.path,
    title: body.title,
    order: body.order,
    markdown: body.markdown,
    contentHash: body.contentHash,
    goalIds: body.goalIds,
    scenarioIds: body.scenarioIds,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** List pages as the sync diff view: id + contentHash ONLY (never the markdown bodies). */
export async function listPages(teamId: string, slug: string): Promise<{ id: string; contentHash: string }[]> {
  const { baseRef } = await resolveBase(teamId, slug);
  const snap = await baseRef.collection("pages").select("contentHash").get();
  return snap.docs.map((d) => ({ id: d.id, contentHash: d.data().contentHash as string }));
}

/**
 * Delete a page doc ONLY. Steering comments live in a separate project-level collection
 * and must survive page deletion, so they are intentionally left untouched here.
 */
export async function deletePage(teamId: string, slug: string, pageId: string): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug);
  await baseRef.collection("pages").doc(pageId).delete();
}
