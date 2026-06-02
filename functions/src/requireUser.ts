import type { RequestHandler } from "express";
import { getAuth } from "firebase-admin/auth";
import { db } from "./firestore.js";
import { AppError } from "./errors.js";

export type TokenVerifier = (idToken: string) => Promise<{ uid: string }>;

const defaultVerifier: TokenVerifier = (idToken) => getAuth().verifyIdToken(idToken);

/** Verifies a Firebase ID token, requires users/{uid}.isAllowed, sets req.uid. */
export function makeRequireUser(verify: TokenVerifier = defaultVerifier): RequestHandler {
  return async (req, _res, next) => {
    try {
      // ID tokens arrive ONLY via Authorization: Bearer — deliberately NOT via the
      // shared extractKey() (which also accepts x-api-key); an ID token must never be
      // accepted through the API-key header. Keep these two auth modes separate.
      const auth = req.headers["authorization"];
      const token = typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length).trim()
        : undefined;
      if (!token) throw new AppError(401, "unauthorized", "missing ID token");

      let uid: string;
      try {
        ({ uid } = await verify(token));
      } catch (e) {
        // Log the real reason server-side (audience mismatch, expired, no app, …);
        // the client only ever sees the generic message.
        console.warn("ID token verification failed (requireUser):", (e as Error)?.message);
        throw new AppError(401, "unauthorized", "invalid ID token");
      }

      const snap = await db().doc(`users/${uid}`).get();
      if (!snap.exists || snap.data()?.isAllowed !== true) {
        throw new AppError(403, "forbidden", "user is not allowed");
      }
      req.uid = uid;
      next();
    } catch (err) {
      next(err);
    }
  };
}
