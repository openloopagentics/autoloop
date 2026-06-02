import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let _db: Firestore | undefined;

export function db(): Firestore {
  if (!_db) {
    if (getApps().length === 0) {
      initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "daloop-dev" });
    }
    _db = getFirestore();
  }
  return _db;
}
