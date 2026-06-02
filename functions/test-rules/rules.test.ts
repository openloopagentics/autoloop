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

describe("rules: members", () => {
  it("the team creator can add themselves as owner (bootstrap)", async () => {
    await setAllowed("alice");
    await seedTeam("t1", "alice"); // team committed first (sequential bootstrap)
    const db = authed("alice");
    await assertSucceeds(db.doc("teams/t1/members/alice").set({ uid: "alice", role: "owner", email: "alice@x.com", inviteId: null }));
  });

  it("a non-creator cannot self-add as owner", async () => {
    await setAllowed("bob");
    await seedTeam("t1", "alice");
    const db = authed("bob");
    await assertFails(db.doc("teams/t1/members/bob").set({ uid: "bob", role: "owner", email: "bob@x.com", inviteId: null }));
  });

  it("a user can read their own member docs across teams (collectionGroup), not others'", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedMember("t1", "carol", "member");
    await assertSucceeds(authed("alice").doc("teams/t1/members/alice").get());
    await assertSucceeds(authed("alice").doc("teams/t1/members/carol").get());
    await assertFails(authed("dave").doc("teams/t1/members/carol").get());
  });

  it("an admin cannot promote a member to owner; an owner can", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedMember("t1", "adam", "admin");
    await seedMember("t1", "carol", "member");
    await assertFails(authed("adam").doc("teams/t1/members/carol").update({ role: "owner" }));
    await assertSucceeds(authed("adam").doc("teams/t1/members/carol").update({ role: "member" }));
    await assertSucceeds(authed("alice").doc("teams/t1/members/carol").update({ role: "admin" }));
  });

  it("a manager cannot edit their own member doc (no self-escalation)", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "adam", "admin");
    await assertFails(authed("adam").doc("teams/t1/members/adam").update({ role: "owner" }));
  });

  it("immutable fields (uid/joinedAt/email/inviteId) cannot change on update", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedMember("t1", "carol", "member");
    await assertFails(authed("alice").doc("teams/t1/members/carol").update({ email: "evil@x.com" }));
  });

  it("a member can remove themselves (leave); a manager can remove others", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedMember("t1", "carol", "member");
    await assertSucceeds(authed("carol").doc("teams/t1/members/carol").delete());
    await seedMember("t1", "carol", "member");
    await assertSucceeds(authed("alice").doc("teams/t1/members/carol").delete());
  });
});

describe("rules: invites", () => {
  async function seedInvite(teamId: string, inviteId: string, email: string, role = "member") {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`teams/${teamId}/invites/${inviteId}`).set({
        email: email.toLowerCase(), role, invitedBy: "alice", status: "pending",
      });
    });
  }

  it("only a manager can create a pending invite", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedMember("t1", "carol", "member");
    await assertSucceeds(authed("alice").doc("teams/t1/invites/i1")
      .set({ email: "new@x.com", role: "member", invitedBy: "alice", status: "pending" }));
    await assertFails(authed("carol").doc("teams/t1/invites/i2")
      .set({ email: "new@x.com", role: "member", invitedBy: "carol", status: "pending" }));
  });

  it("the invitee (by verified email, case-insensitive) can read their invite; others cannot", async () => {
    await seedTeam("t1", "alice");
    await seedInvite("t1", "i1", "new@x.com");
    await assertSucceeds(authed("newbie", "New@X.com").doc("teams/t1/invites/i1").get());
    await assertFails(authed("stranger", "stranger@x.com").doc("teams/t1/invites/i1").get());
  });

  it("a valid invitee accepts atomically: member created + invite deleted", async () => {
    await setAllowed("newbie", "new@x.com");
    await seedTeam("t1", "alice");
    await seedInvite("t1", "i1", "new@x.com", "member");
    const db = authed("newbie", "new@x.com");
    const batch = db.batch();
    batch.set(db.doc("teams/t1/members/newbie"), { uid: "newbie", role: "member", email: "new@x.com", inviteId: "i1" });
    batch.delete(db.doc("teams/t1/invites/i1"));
    await assertSucceeds(batch.commit());
  });

  it("accept fails if the role does not match the invite", async () => {
    await setAllowed("newbie", "new@x.com");
    await seedTeam("t1", "alice");
    await seedInvite("t1", "i1", "new@x.com", "member");
    const db = authed("newbie", "new@x.com");
    const batch = db.batch();
    batch.set(db.doc("teams/t1/members/newbie"), { uid: "newbie", role: "owner", email: "new@x.com", inviteId: "i1" });
    batch.delete(db.doc("teams/t1/invites/i1"));
    await assertFails(batch.commit());
  });

  it("accept fails for a non-isAllowed invitee", async () => {
    await setAllowed("newbie", "new@x.com", false);
    await seedTeam("t1", "alice");
    await seedInvite("t1", "i1", "new@x.com", "member");
    const db = authed("newbie", "new@x.com");
    const batch = db.batch();
    batch.set(db.doc("teams/t1/members/newbie"), { uid: "newbie", role: "member", email: "new@x.com", inviteId: "i1" });
    batch.delete(db.doc("teams/t1/invites/i1"));
    await assertFails(batch.commit());
  });

  it("accept fails when the member doc carries a missing/unknown inviteId", async () => {
    await setAllowed("newbie", "new@x.com");
    await seedTeam("t1", "alice");
    await seedInvite("t1", "i1", "new@x.com", "member");
    const db = authed("newbie", "new@x.com");
    await assertFails(db.doc("teams/t1/members/newbie")
      .set({ uid: "newbie", role: "member", email: "new@x.com", inviteId: "nope" }));
  });
});
