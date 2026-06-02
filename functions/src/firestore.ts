import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let _db: Firestore | undefined;

export function db(): Firestore {
  if (!_db) {
    if (getApps().length === 0) {
      // No explicit projectId: the Admin SDK auto-detects it — from the metadata
      // server when deployed (Cloud Functions / Cloud Run), or from the
      // GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT env the emulator harness sets in tests.
      // (Hardcoding a fallback here would point production at the wrong project.)
      initializeApp();
    }
    _db = getFirestore();
  }
  return _db;
}
