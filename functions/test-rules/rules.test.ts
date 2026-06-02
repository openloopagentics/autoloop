import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

// Resolve firestore.rules relative to THIS file (repo root), not the cwd.
// __dirname = functions/test-rules → ../../firestore.rules = repo root.
const here = dirname(fileURLToPath(import.meta.url));
const rulesPath = resolve(here, "../../firestore.rules");

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "daloop-rules-test",
    firestore: { rules: readFileSync(rulesPath, "utf8") },
  });
});

afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

async function seedProject() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("projects/acme").set({ title: "Acme", status: "running" });
  });
}
async function allow(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${uid}`).set({ isAllowed: true });
  });
}

describe("firestore.rules", () => {
  it("denies anonymous reads", async () => {
    await seedProject();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.doc("projects/acme").get());
  });

  it("denies signed-in users with no user doc", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("nobody").firestore();
    await assertFails(db.doc("projects/acme").get());
  });

  it("allows reads for allowlisted users", async () => {
    await seedProject();
    await allow("vip");
    const db = testEnv.authenticatedContext("vip").firestore();
    await assertSucceeds(db.doc("projects/acme").get());
  });

  it("denies all client writes even for allowlisted users", async () => {
    await allow("vip");
    const db = testEnv.authenticatedContext("vip").firestore();
    await assertFails(db.doc("projects/acme").set({ title: "x" }));
  });
});
