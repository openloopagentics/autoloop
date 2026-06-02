import type { RequestHandler } from "express";
import { db } from "./firestore.js";
import { AppError } from "./errors.js";
import { extractKey } from "./auth.js";
import { hashKey } from "./apiKeys.js";

/** Resolves an API key to its user and authorizes against the path's teamId. */
export const requireApiKeyMember: RequestHandler = async (req, _res, next) => {
  try {
    const key = extractKey(req.headers as Record<string, string | string[] | undefined>);
    if (!key) throw new AppError(401, "unauthorized", "missing API key");

    const keySnap = await db().doc(`apiKeys/${hashKey(key)}`).get();
    if (!keySnap.exists) throw new AppError(401, "unauthorized", "invalid API key");
    const uid = keySnap.data()!.uid as string;

    const { teamId } = req.params as { teamId: string };
    const memberSnap = await db().doc(`teams/${teamId}/members/${uid}`).get();
    if (!memberSnap.exists) throw new AppError(403, "forbidden", "not a member of this team");

    req.uid = uid;
    next();
  } catch (err) {
    next(err);
  }
};
