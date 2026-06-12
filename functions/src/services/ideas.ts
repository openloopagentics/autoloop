import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../errors.js";
import { resolveBase } from "./baseRef.js";
import type { IdeaBody } from "../schemas.js";

/** Band ranks for listing: the user's queue first, then the loop's proposals, then the vetoed, then the shipped. */
const BAND: Record<string, number> = { accepted: 0, proposed: 1, rejected: 2, done: 3 };

/**
 * Upsert an idea (idempotent PUT). PROJECT-DIRECT ONLY — ideas outlive the loop that
 * proposed them, so there is no loopId variant. An idea is run data — no derived
 * currentX, no visionOwner stamp, no transaction (mirrors upsertBug).
 * `by` is the caller's AUTH PATH (agent key vs /v1/u/), never the request body.
 * decidedAt is stamped the FIRST time status becomes accepted/rejected — including
 * when the idea is created directly as accepted/rejected — and never updated after.
 */
export async function upsertIdea(teamId: string, slug: string, ideaId: string, body: IdeaBody, by: "agent" | "user"): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug); // project-level (404s on a missing project)
  const ideaRef = baseRef.collection("ideas").doc(ideaId);
  const snap = await ideaRef.get();
  const creating = !snap.exists;
  if (creating && (body.title === undefined || body.status === undefined || body.order === undefined)) {
    throw new AppError(400, "validation", "title, status and order are required when creating an idea");
  }
  const existing = snap.data() ?? {};
  const newStatus = body.status ?? existing.status;

  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (creating) { data.createdAt = FieldValue.serverTimestamp(); data.by = by; data.decidedAt = null; }
  if (body.title !== undefined) data.title = body.title;
  if (body.rationale !== undefined) data.rationale = body.rationale;
  if (body.status !== undefined) data.status = body.status;
  if (body.order !== undefined) data.order = body.order;
  if (body.originLoopId !== undefined) data.originLoopId = body.originLoopId;
  if (body.builtInLoopId !== undefined) data.builtInLoopId = body.builtInLoopId;
  // decidedAt = the FIRST transition into accepted/rejected (overrides the create-time null).
  if ((newStatus === "accepted" || newStatus === "rejected") && !existing.decidedAt) {
    data.decidedAt = FieldValue.serverTimestamp();
  }

  await ideaRef.set(data, { merge: true });
}

export interface IdeaView {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  decidedAt: string | null;
  [k: string]: unknown;
}

/**
 * List ALL ideas, sorted in memory: status band (accepted → proposed → rejected → done),
 * then order, then createdAt. Ideas are tens, not thousands — single collection read,
 * no composite index (consistent with the existing YAGNI-on-indexes decision).
 * Server timestamps serialized to ISO strings like the messages GET.
 */
export async function listIdeas(teamId: string, slug: string): Promise<IdeaView[]> {
  const { baseRef } = await resolveBase(teamId, slug);
  const snap = await baseRef.collection("ideas").get();
  const iso = (v: unknown): string | null => {
    const ts = v as { toDate?: () => Date } | null | undefined;
    return ts?.toDate ? ts.toDate().toISOString() : null;
  };
  const ideas: IdeaView[] = snap.docs.map((d) => {
    const v = d.data();
    return { ...v, id: d.id, createdAt: iso(v.createdAt), updatedAt: iso(v.updatedAt), decidedAt: iso(v.decidedAt) };
  });
  ideas.sort((a, b) =>
    ((BAND[a.status as string] ?? 9) - (BAND[b.status as string] ?? 9))
    || ((a.order as number ?? 0) - (b.order as number ?? 0))
    || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  return ideas;
}
