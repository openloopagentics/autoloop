import { beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../src/firestore.js";
import { resetRateLimiter } from "../src/rateLimit.js";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "autoloop-test";

const PROJECT_ID = process.env.GCLOUD_PROJECT;

export const TEST_UID = "agent1";
// Deliberately short — not a real generateKey() output; the middleware only checks
// that hashKey(TEST_KEY) exists in apiKeys, so length/format don't matter for tests.
export const TEST_KEY = "al_testkey";
const TEST_KEY_HASH = createHash("sha256").update(TEST_KEY).digest("hex");

export async function clearFirestore(): Promise<void> {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
}

export function authHeader() {
  return { Authorization: `Bearer ${TEST_KEY}` };
}

export async function seedApiKey(uid = TEST_UID): Promise<void> {
  await db().doc(`apiKeys/${TEST_KEY_HASH}`).set({ uid, label: "test", prefix: "al_testk", createdAt: FieldValue.serverTimestamp() });
}

export async function seedMember(teamId: string, uid = TEST_UID, role = "member"): Promise<void> {
  await db().doc(`teams/${teamId}/members/${uid}`).set({ uid, role, email: `${uid}@x.com`, inviteId: null });
}

beforeEach(async () => {
  await clearFirestore();
  resetRateLimiter(); // in-memory per-key counters must not leak across tests
  await seedApiKey(); // the test key always resolves to TEST_UID
});
