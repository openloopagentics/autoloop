import type { RequestHandler } from "express";
import { getAuth } from "firebase-admin/auth";
import { db } from "./firestore.js";
import { AppError } from "./errors.js";

export type TokenVerifier = (idToken: string) => Promise<{ uid: string }>;
const defaultVerifier: TokenVerifier = (idToken) => getAuth().verifyIdToken(idToken);

/** Verify ID token, require users/{uid}.isAllowed && isAdmin, set req.uid. */
export function makeRequireAdmin(verify: TokenVerifier = defaultVerifier): RequestHandler {
  return async (req, _res, next) => {
    try {
      const auth = req.headers["authorization"];
      const token = typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length).trim() : undefined;
      if (!token) throw new AppError(401, "unauthorized", "missing ID token");
      let uid: string;
      try { ({ uid } = await verify(token)); } catch { throw new AppError(401, "unauthorized", "invalid ID token"); }
      const snap = await db().doc(`users/${uid}`).get();
      const d = snap.data();
      if (!snap.exists || d?.isAllowed !== true || d?.isAdmin !== true) {
        throw new AppError(403, "forbidden", "admin access required");
      }
      req.uid = uid;
      next();
    } catch (err) { next(err); }
  };
}
