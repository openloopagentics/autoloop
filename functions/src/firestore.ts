import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Initialize the default Admin app exactly once (idempotent). Must run before
 * ANY Admin SDK call — including getAuth().verifyIdToken() in the auth
 * middleware, which would otherwise throw "default app does not exist" on a
 * cold instance whose first request is ID-token-gated (e.g. GET /v1/keys).
 *
 * No explicit projectId: the Admin SDK auto-detects it — from the metadata
 * server when deployed (Cloud Functions / Cloud Run), or from the
 * GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT env the emulator harness sets in tests.
 * (Hardcoding a fallback here would point production at the wrong project.)
 */
export function ensureApp(): void {
  if (getApps().length === 0) initializeApp();
}

let _db: Firestore | undefined;

export function db(): Firestore {
  ensureApp();
  if (!_db) _db = getFirestore();
  return _db;
}
