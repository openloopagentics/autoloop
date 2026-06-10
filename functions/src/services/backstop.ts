import { FieldValue } from "firebase-admin/firestore";
import { isTerminal, type Status } from "../status.js";
import { stampEndedAt } from "./phases.js";

type DocRef = FirebaseFirestore.DocumentReference;

/**
 * Deterministic backstop: when a loop (or the project, for project-direct data)
 * transitions INTO a terminal status, set every non-terminal phase/task under
 * baseRef to that SAME terminal status and null the derived
 * currentPhaseId/currentTaskId pointers on the base doc — the well-behaved close
 * path ends with both pointers null via the derive.ts recomputes, and the sweep
 * must land in the same end state so the UI stops rendering a "current" task.
 *
 * Best-effort and post-transaction: the close itself never fails because the
 * sweep failed — log and continue (consistent with the API's write-only,
 * agent-trusting posture). Batched writes of ≤500.
 */
export async function sweepToTerminal(baseRef: DocRef, terminalStatus: Status): Promise<void> {
  try {
    const [phasesSnap, tasksSnap] = await Promise.all([
      baseRef.collection("phases").get(),
      baseRef.collection("tasks").get(),
    ]);
    const writes: Array<{ ref: DocRef; data: Record<string, unknown> }> = [];
    for (const d of phasesSnap.docs) {
      if (isTerminal(d.data().status as Status)) continue; // already-terminal docs stay byte-stable
      const data: Record<string, unknown> = { status: terminalStatus, updatedAt: FieldValue.serverTimestamp() };
      stampEndedAt(data, terminalStatus, d.data().endedAt); // phases only — tasks have no endedAt field
      writes.push({ ref: d.ref, data });
    }
    for (const d of tasksSnap.docs) {
      if (isTerminal(d.data().status as Status)) continue;
      writes.push({ ref: d.ref, data: { status: terminalStatus, updatedAt: FieldValue.serverTimestamp() } });
    }
    writes.push({ ref: baseRef, data: { currentPhaseId: null, currentTaskId: null, updatedAt: FieldValue.serverTimestamp() } });
    while (writes.length > 0) {
      const chunk = writes.splice(0, 500);
      const batch = baseRef.firestore.batch();
      for (const w of chunk) batch.set(w.ref, w.data, { merge: true });
      await batch.commit();
    }
  } catch (e) {
    console.error("backstop sweep failed (the terminal close itself was already applied):", e);
  }
}
