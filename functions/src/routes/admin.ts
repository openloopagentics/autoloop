import { Router } from "express";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";

const UID = /^[A-Za-z0-9._-]+$/; // Firebase uids are alnum; allow safe punctuation
const putBody = z.object({ isAllowed: z.boolean(), email: z.string().optional() });
const decisionBody = z.object({ decision: z.enum(["approve", "deny"]) });

export const adminRouter = Router();

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const q = await db().collection("users").get();
    res.status(200).json({
      users: q.docs.map((d) => ({
        uid: d.id, email: d.data().email, isAllowed: d.data().isAllowed === true, isAdmin: d.data().isAdmin === true,
      })),
    });
  } catch (err) { next(err); }
});

adminRouter.put("/users/:uid", async (req, res, next) => {
  try {
    const uid = req.params.uid;
    if (!UID.test(uid)) throw new AppError(400, "validation", "invalid uid");
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const data: Record<string, unknown> = { isAllowed: parsed.data.isAllowed };
    if (parsed.data.email !== undefined) data.email = parsed.data.email;
    await db().doc(`users/${uid}`).set(data, { merge: true }); // never touches isAdmin
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get("/access-requests", async (_req, res, next) => {
  try {
    const q = await db().collection("accessRequests").where("status", "==", "pending").get();
    res.status(200).json({
      requests: q.docs.map((d) => ({ uid: d.id, ...(d.data() as object) })),
    });
  } catch (err) { next(err); }
});

adminRouter.post("/access-requests/:uid", async (req, res, next) => {
  try {
    const uid = req.params.uid;
    if (!UID.test(uid)) throw new AppError(400, "validation", "invalid uid");
    const parsed = decisionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const reqRef = db().doc(`accessRequests/${uid}`);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) throw new AppError(404, "not_found", "access request not found");

    const batch = db().batch();
    if (parsed.data.decision === "approve") {
      const email = reqSnap.data()!.email as string | undefined;
      const userData: Record<string, unknown> = { isAllowed: true };
      if (email !== undefined) userData.email = email;
      batch.set(db().doc(`users/${uid}`), userData, { merge: true }); // never touches isAdmin
      batch.set(reqRef, { status: "approved", decidedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      batch.set(reqRef, { status: "denied", decidedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
