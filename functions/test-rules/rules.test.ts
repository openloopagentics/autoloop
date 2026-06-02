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

// --- seed helpers (bypass rules) ---
async function setAllowed(uid: string, email = `${uid}@x.com`, isAllowed = true) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${uid}`).set({ email, isAllowed });
  });
}
async function seedTeam(teamId: string, createdBy: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`teams/${teamId}`).set({ name: "T", createdBy });
  });
}
async function seedMember(teamId: string, uid: string, role: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`teams/${teamId}/members/${uid}`).set({ uid, role, email: `${uid}@x.com`, inviteId: null });
  });
}
function authed(uid: string, email = `${uid}@x.com`) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

describe("rules: teams/{teamId}", () => {
  it("an isAllowed user can create a team with themselves as createdBy", async () => {
    await setAllowed("alice");
    const db = authed("alice");
    await assertSucceeds(db.doc("teams/t1").set({ name: "T", createdBy: "alice" }));
  });

  it("a non-isAllowed user cannot create a team", async () => {
    await setAllowed("mallory", "mallory@x.com", false);
    const db = authed("mallory");
    await assertFails(db.doc("teams/t1").set({ name: "T", createdBy: "mallory" }));
  });

  it("cannot create a team with someone else as createdBy", async () => {
    await setAllowed("alice");
    const db = authed("alice");
    await assertFails(db.doc("teams/t1").set({ name: "T", createdBy: "bob" }));
  });

  it("only members can read a team; non-members cannot", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await assertSucceeds(authed("alice").doc("teams/t1").get());
    await assertFails(authed("bob").doc("teams/t1").get());
  });

  it("a manager can update the team; a plain member cannot", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedMember("t1", "carol", "member");
    await assertSucceeds(authed("alice").doc("teams/t1").update({ name: "New" }));
    await assertFails(authed("carol").doc("teams/t1").update({ name: "Nope" }));
  });
});
