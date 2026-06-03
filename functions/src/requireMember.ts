import type { RequestHandler } from "express";
import { db } from "./firestore.js";
import { AppError } from "./errors.js";

/**
 * Authorizes an already-authenticated user (req.uid, set by makeRequireUser) against
 * the path's :teamId. Mount AFTER makeRequireUser on a mergeParams subtree.
 */
export const requireMember: RequestHandler = async (req, _res, next) => {
  try {
    const uid = (req as { uid?: string }).uid;
    if (!uid) throw new AppError(401, "unauthorized", "missing user");
    const { teamId } = req.params as { teamId: string };
    const memberSnap = await db().doc(`teams/${teamId}/members/${uid}`).get();
    if (!memberSnap.exists) throw new AppError(403, "forbidden", "not a member of this team");
    next();
  } catch (err) {
    next(err);
  }
};
