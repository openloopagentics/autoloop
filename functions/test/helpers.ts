import { beforeEach } from "vitest";

// Point the Admin SDK at the local emulator BEFORE any admin import initializes.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "daloop-test";
process.env.DALOOP_WRITE_KEYS ??= "test-key";

const PROJECT_ID = process.env.GCLOUD_PROJECT;

export async function clearFirestore(): Promise<void> {
  // REST endpoint exposed by the Firestore emulator to wipe all data.
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
}

export function authHeader() {
  return { Authorization: "Bearer test-key" };
}

beforeEach(async () => {
  await clearFirestore();
});
