# Multi-Tenant Foundation (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Autoloop multi-tenant: teams own projects, the team/membership/invite model and its Firestore security rules exist, and the agent write endpoints are repointed under `/v1/teams/{teamId}/...` (shared-key auth kept as a stopgap until Sub-project B).

**Architecture:** Projects/phases/commits move under `teams/{teamId}/projects/{slug}/...`; their transaction logic is otherwise unchanged. Team/member/invite management is done by the UI writing Firestore directly, governed by new security rules; the API (Admin SDK) keeps writing project status and bypasses those rules. The bulk of the work and risk is in `firestore.rules`, which is built up and tested block-by-block.

**Tech Stack:** TypeScript, Firebase Cloud Functions v2, Express 4, Zod, Firebase Admin SDK, Vitest + Supertest, Firestore emulator, `@firebase/rules-unit-testing`.

**Reference spec:** `docs/superpowers/specs/2026-06-01-multitenant-foundation-design.md`
**Builds on:** `docs/superpowers/specs/2026-06-01-rest-api-design.md` (single-tenant API already implemented)

---

## Background the implementer needs

The repo already has a working single-tenant API under `functions/`:
- `src/services/{projects,phases,commits}.ts` — Firestore transactions; refs are currently `projects/{slug}` etc.
- `src/routes/{projects,phases,commits}.ts` — Express routers (phases/commits use `Router({ mergeParams: true })`).
- `src/app.ts` — `makeApp()` mounts routers under `/v1/...` behind `requireWriteKey`.
- `src/{auth,errors,schemas,status,firestore}.ts` — unchanged by this sub-project.
- `firestore.rules` — current single-tenant read-allowlist (gates top-level `projects/**` on `users/{uid}.isAllowed`). **This file is fully rewritten here.**
- Tests: `test/{projects,phases,commits,integration}.test.ts` (emulator + Supertest, `test/helpers.ts` clears Firestore each test and exports `authHeader()`), and `test-rules/rules.test.ts` (rules tests, **rewritten here**).

**Test commands** (unchanged): `npm run test:run -- <filter>` for the filtered TDD loop (needs `npm run emulators` running in another terminal); `npm test` self-launches the emulator for the full suite; `npm run test:rules` self-launches for the rules suite. For the inner loop, start `npm run emulators` in the background on port 8080 first.

**Key constraints baked into the rules (from the spec):**
- Firestore rules cannot query; inside a batch, `get()`/`exists()` see only pre-batch state.
- Team bootstrap = two **sequential** writes (team, then owner member). Invite accept = one **atomic batch** carrying the `inviteId` in the member doc.
- `isAllowed` gates only entry points (team create, invite accept); day-to-day reads check membership.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `firestore.indexes.json` | modify | add the `collectionGroup` index on `members.uid` |
| `functions/src/services/projects.ts` | modify | team-existence 404; refs under `teams/{teamId}` |
| `functions/src/services/phases.ts` | modify | refs under `teams/{teamId}` |
| `functions/src/services/commits.ts` | modify | refs under `teams/{teamId}` |
| `functions/src/routes/projects.ts` | modify | read+validate `teamId`; mergeParams |
| `functions/src/routes/phases.ts` | modify | validate `teamId` |
| `functions/src/routes/commits.ts` | modify | validate `teamId` |
| `functions/src/app.ts` | modify | mount routers under `/v1/teams/:teamId/...` |
| `functions/test/{projects,phases,commits,integration}.test.ts` | modify | new paths; seed a team first |
| `firestore.rules` | rewrite | multi-tenant rules, built block-by-block |
| `functions/test-rules/rules.test.ts` | rewrite | rules tests, built block-by-block |

---

## Task 1: Add the collectionGroup index

**Files:** Modify `firestore.indexes.json`

The "which teams am I in?" query is `collectionGroup('members').where('uid','==', me)`. That needs a single-field collectionGroup index. (The emulator auto-creates single-field indexes, so tests pass without it, but production deploy needs it declared.)

- [ ] **Step 1: Replace `firestore.indexes.json`**

```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "members",
      "fieldPath": "uid",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Validate JSON**

Run: `cd functions && node -e "require('../firestore.indexes.json'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add firestore.indexes.json
git commit -m "feat: add collectionGroup index on members.uid for my-teams query"
```

---

## Task 2: Repoint the write API under teams/{teamId}

**Files:** Modify `functions/src/services/{projects,phases,commits}.ts`, `functions/src/routes/{projects,phases,commits}.ts`, `functions/src/app.ts`, `functions/test/{projects,phases,commits,integration}.test.ts`

This is one cohesive, atomic change: all three endpoints move under the team path together (the shared `app.ts` mounts and path prefix make a partial move leave a broken intermediate state). Do the tests first (they'll fail), then the implementation.

> **Emulator:** start `npm run emulators` in a background shell on port 8080 before the inner loop; use `npm run test:run -- <filter>`.

- [ ] **Step 1: Update `test/projects.test.ts` to the team path + add a team-404 test**

Add a team-seeding helper and a `T = "team1"` constant at the top (after `const app = makeApp();`):

```typescript
async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
}
```

Then change every request path from `/v1/projects/...` to `/v1/teams/team1/projects/...`, every `db().doc("projects/acme...")` to `db().doc("teams/team1/projects/acme...")`, and call `await seedTeam()` at the start of each test that writes a project (i.e. all of them except the unauthenticated/invalid-slug cases, which fail before touching Firestore). Add one new test:

```typescript
it("404s when the team does not exist", async () => {
  const res = await request(app).put("/v1/teams/ghostteam/projects/acme")
    .set(authHeader()).send({ title: "Acme", status: "queued" });
  expect(res.status).toBe(404);
});
```

Keep the "rejects an invalid slug" test, and add an invalid-teamId test:
```typescript
it("rejects an invalid teamId", async () => {
  const res = await request(app).put("/v1/teams/Bad%20Team/projects/acme")
    .set(authHeader()).send({ title: "x", status: "queued" });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run RED** — `npm run test:run -- projects` → FAIL (paths 404 / signature mismatch).

- [ ] **Step 3: Update `src/services/projects.ts`**

Change the signature to take `teamId` and add the team-existence check inside the transaction. New body:

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { ProjectBody } from "../schemas.js";

export async function upsertProject(teamId: string, slug: string, body: ProjectBody): Promise<void> {
  const teamRef = db().doc(`teams/${teamId}`);
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  await db().runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) throw new AppError(404, "not_found", "team does not exist");

    const snap = await tx.get(ref);
    const creating = !snap.exists;
    if (creating) {
      if (!body.title || !body.status) {
        throw new AppError(400, "validation", "title and status are required when creating a project");
      }
    }
    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) {
      data.slug = slug;
      data.createdAt = FieldValue.serverTimestamp();
      data.currentPhaseId = null;
    }
    if (body.title !== undefined) data.title = body.title;
    if (body.status !== undefined) data.status = body.status;
    if (body.design !== undefined) {
      data.design = { ...body.design, updatedAt: FieldValue.serverTimestamp() };
    }
    tx.set(ref, data, { merge: true });
  });
}
```

- [ ] **Step 4: Update `src/services/phases.ts`**

Change signature to `upsertPhase(teamId, slug, phaseId, body)`; change the two ref lines only:
```typescript
const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
const phaseRef = projectRef.collection("phases").doc(phaseId);
```
Everything else (the 404-on-missing-project check, the `currentPhaseId` recompute reading `projectRef.collection("phases")`, `endedAt`, timestamps) stays exactly the same.

- [ ] **Step 5: Update `src/services/commits.ts`**

Change signature to `upsertCommit(teamId, slug, phaseId, sha, body)`; change the ref line only:
```typescript
const phaseRef = db().doc(`teams/${teamId}/projects/${slug}/phases/${phaseId}`);
```
Everything else stays the same.

- [ ] **Step 6: Update the three routes to read & validate `teamId`**

`src/routes/projects.ts` — make it `Router({ mergeParams: true })` and validate `teamId`:
```typescript
import { Router } from "express";
import { idPattern, projectBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertProject } from "../services/projects.js";

export const projectsRouter = Router({ mergeParams: true });

projectsRouter.put("/:slug", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as { teamId: string; slug: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    const parsed = projectBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertProject(teamId, slug, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

`src/routes/phases.ts` — add `teamId` to the destructure + validation, and pass it:
```typescript
const { teamId, slug, phaseId } = req.params as { teamId: string; slug: string; phaseId: string };
if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
// ...existing slug + phaseId validation...
await upsertPhase(teamId, slug, phaseId, parsed.data);
```

`src/routes/commits.ts` — add `teamId` to the id loop and pass it:
```typescript
const { teamId, slug, phaseId, sha } = req.params as { teamId: string; slug: string; phaseId: string; sha: string };
for (const [id, val] of [["teamId", teamId], ["slug", slug], ["phaseId", phaseId], ["sha", sha]] as const) {
  if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${id}`);
}
const parsed = commitBody.safeParse(req.body);
if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
await upsertCommit(teamId, slug, phaseId, sha, parsed.data);
```

- [ ] **Step 7: Update `src/app.ts` mounts**

Replace the three router mounts with the team-nested paths (the catch-all 404 and errorHandler stay last):
```typescript
app.use("/v1/teams/:teamId/projects", projectsRouter);
app.use("/v1/teams/:teamId/projects/:slug/phases", phasesRouter);
app.use("/v1/teams/:teamId/projects/:slug/phases/:phaseId/commits", commitsRouter);
```

- [ ] **Step 8: Update `test/phases.test.ts`, `test/commits.test.ts`, `test/integration.test.ts`**

In each: add the `seedTeam` helper (same as Step 1), call `await seedTeam()` before the project/phase setup, and change all paths and `db().doc(...)` references from `/v1/projects/...` / `projects/...` to `/v1/teams/team1/projects/...` / `teams/team1/projects/...`. (The phases "404s when the project does not exist" test should seed the team first, then target a missing project — it should still 404.)

- [ ] **Step 9: Run GREEN** — `npm run test:run -- projects`, `-- phases`, `-- commits`, `-- integration` all PASS. Then the full suite `npm run test:run` (or `npm test`) → all green.

- [ ] **Step 10: Build** — `npm run build` → no type errors.

- [ ] **Step 11: Commit**

```bash
git add functions/src/services functions/src/routes functions/src/app.ts functions/test
git commit -m "feat: repoint write API under teams/{teamId} with team-existence 404"
```

---

## Task 3: Rules — skeleton, helpers, users, and teams/{teamId}

**Files:** Rewrite `firestore.rules`; rewrite `functions/test-rules/rules.test.ts`

This replaces the single-tenant rules with the multi-tenant skeleton: helper functions, the carried-over `users/{uid}` rules, and the `teams/{teamId}` document CRUD. Members/invites/projects blocks are added in Tasks 4–6. The old rules tests are replaced here with the new team-focused suite.

> **Emulator:** rules tests self-launch via `npm run test:rules`. Clear port 8080 first (`lsof -ti tcp:8080 | xargs kill 2>/dev/null`).

- [ ] **Step 1: Rewrite `functions/test-rules/rules.test.ts`** (replace the whole file)

Keep the existing `beforeAll`/`afterAll`/`beforeEach` harness and the `import.meta.url`-based `rulesPath`. Replace the seed helpers and describe block with:

```typescript
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
    projectId: "autoloop-rules-test",
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
// auth context with a verified email token
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
```

- [ ] **Step 2: Run RED** — `npm run test:rules` → FAIL (current rules don't match this model).

- [ ] **Step 3: Rewrite `firestore.rules`** (skeleton + helpers + users + teams CRUD)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }

    function isAllowedUser() {
      return isSignedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAllowed == true;
    }

    function isMember(teamId) {
      return isSignedIn()
        && exists(/databases/$(database)/documents/teams/$(teamId)/members/$(request.auth.uid));
    }
    function memberRole(teamId) {
      return get(/databases/$(database)/documents/teams/$(teamId)/members/$(request.auth.uid)).data.role;
    }
    function isManager(teamId) {
      return isMember(teamId) && (memberRole(teamId) == 'owner' || memberRole(teamId) == 'admin');
    }
    function isOwner(teamId) {
      return isMember(teamId) && memberRole(teamId) == 'owner';
    }

    match /users/{uid} {
      allow read: if isSignedIn() && request.auth.uid == uid;
      allow write: if false;
    }

    match /teams/{teamId} {
      allow read: if isMember(teamId);
      allow create: if isAllowedUser() && request.resource.data.createdBy == request.auth.uid;
      allow update: if isManager(teamId);
      allow delete: if isOwner(teamId);

      // members/{uid}, invites/{inviteId}, projects/** added in Tasks 4-6
    }
  }
}
```

- [ ] **Step 4: Run GREEN** — `npm run test:rules` → all team tests PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules functions/test-rules/rules.test.ts
git commit -m "feat: multi-tenant rules skeleton + teams CRUD"
```

---

## Task 4: Rules — members (bootstrap, reverse-read, update constraints, delete)

**Files:** Modify `firestore.rules`; append to `functions/test-rules/rules.test.ts`

- [ ] **Step 1: Append member tests** to `rules.test.ts`

```typescript
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
    // own doc: ok
    await assertSucceeds(authed("alice").doc("teams/t1/members/alice").get());
    // teammate doc via membership: ok
    await assertSucceeds(authed("alice").doc("teams/t1/members/carol").get());
    // outsider reading a member doc they don't own and aren't a member: fail
    await assertFails(authed("dave").doc("teams/t1/members/carol").get());
  });

  it("an admin cannot promote a member to owner; an owner can", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedMember("t1", "adam", "admin");
    await seedMember("t1", "carol", "member");
    // admin tries to promote carol -> owner: fail
    await assertFails(authed("adam").doc("teams/t1/members/carol").update({ role: "owner" }));
    // admin promotes carol -> member (no-op-ish, allowed): ok
    await assertSucceeds(authed("adam").doc("teams/t1/members/carol").update({ role: "member" }));
    // owner promotes carol -> admin: ok
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
```

- [ ] **Step 2: Run RED** — `npm run test:rules` → the member tests FAIL.

- [ ] **Step 3: Add the collectionGroup match + members block to `firestore.rules`**

Add the collection-group match at the top level (a sibling of `match /users/...`, inside `match /databases/{database}/documents`):
```
    // Reverse lookup: a user reads their own member docs across all teams.
    match /{path=**}/members/{memberId} {
      allow read: if isSignedIn() && request.auth.uid == resource.data.uid;
    }
```

Add the members block **inside** `match /teams/{teamId} { ... }` (replacing the "members/... added in Tasks 4-6" comment):
```
      match /members/{uid} {
        allow read: if isMember(teamId);

        // bootstrap owner (team already committed) OR invite-accept (added in Task 5)
        allow create: if request.auth.uid == uid
          && request.resource.data.role == 'owner'
          && isAllowedUser()
          && request.auth.uid == get(/databases/$(database)/documents/teams/$(teamId)).data.createdBy;

        allow update: if isManager(teamId)
          && request.auth.uid != uid
          && request.resource.data.get('uid', null) == resource.data.get('uid', null)
          && request.resource.data.get('joinedAt', null) == resource.data.get('joinedAt', null)
          && request.resource.data.get('email', null) == resource.data.get('email', null)
          && request.resource.data.get('inviteId', null) == resource.data.get('inviteId', null)
          // Owners may set any role on anyone. Admins may only act on a target who is
          // currently a plain member, and only keep them a member — admins cannot touch
          // (demote/promote) owners or other admins.
          && (isOwner(teamId)
              || (request.resource.data.role == 'member' && resource.data.role == 'member'));

        allow delete: if isManager(teamId) || request.auth.uid == uid;
      }
```

> **Why `.get(field, default)`:** in Firestore rules, reading an *absent* field via dot
> notation (`request.resource.data.joinedAt` when the doc has no `joinedAt`) raises an
> error and denies the request — it does NOT evaluate to null. The seeded member docs
> omit `joinedAt`, so the immutable pins MUST use the absent-safe `map.get(key, default)`
> form on both sides. This keeps legitimate role updates passing while still pinning any
> field a client tries to change.

- [ ] **Step 4: Run GREEN** — `npm run test:rules` → all member tests PASS (plus the Task 3 team tests still pass).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules functions/test-rules/rules.test.ts
git commit -m "feat: member rules - bootstrap, reverse-read, update constraints, leave"
```

---

## Task 5: Rules — invites (create, read, atomic accept)

**Files:** Modify `firestore.rules`; append to `functions/test-rules/rules.test.ts`

The invite-accept member-create branch is added to the existing `members/{uid}` create rule (as an OR), and a new `invites/{inviteId}` block is added.

- [ ] **Step 1: Append invite tests** to `rules.test.ts`

```typescript
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
    // mixed-case token email still matches the lowercased stored email
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
    // inviteId points at a non-existent invite -> exists() in the OR-branch fails -> denied
    await assertFails(db.doc("teams/t1/members/newbie")
      .set({ uid: "newbie", role: "member", email: "new@x.com", inviteId: "nope" }));
  });
});
```

> Note: the rules-unit-testing context's `.firestore()` returns a compat Firestore
> instance (same style the rest of the rules suite already uses), so `db.batch()` /
> `batch.set(ref, data)` / `batch.delete(ref)` / `batch.commit()` work with no extra
> dependency. Both writes in the batch are evaluated against pre-batch state, so the
> accept is atomic.

- [ ] **Step 2: Run RED** — `npm run test:rules` → the invite tests FAIL.

- [ ] **Step 3: Extend the `members/{uid}` create rule** with the invite-accept OR-branch

Replace the members create rule from Task 4 with:
```
        allow create: if request.auth.uid == uid && (
          // bootstrap owner
          (request.resource.data.role == 'owner'
            && isAllowedUser()
            && request.auth.uid == get(/databases/$(database)/documents/teams/$(teamId)).data.createdBy)
          ||
          // invite accept (inviteId carried in the new member doc)
          (isAllowedUser()
            && request.auth.token.email_verified == true
            && exists(/databases/$(database)/documents/teams/$(teamId)/invites/$(request.resource.data.inviteId))
            && get(/databases/$(database)/documents/teams/$(teamId)/invites/$(request.resource.data.inviteId)).data.status == 'pending'
            && get(/databases/$(database)/documents/teams/$(teamId)/invites/$(request.resource.data.inviteId)).data.email == request.auth.token.email.lower()
            && request.resource.data.role == get(/databases/$(database)/documents/teams/$(teamId)/invites/$(request.resource.data.inviteId)).data.role)
        );
```

- [ ] **Step 4: Add the `invites/{inviteId}` block** inside `match /teams/{teamId} { ... }`

```
      match /invites/{inviteId} {
        allow read: if isManager(teamId)
          || (isSignedIn() && request.auth.token.email_verified == true
              && resource.data.email == request.auth.token.email.lower());

        allow create: if isManager(teamId)
          && request.resource.data.status == 'pending'
          && request.resource.data.invitedBy == request.auth.uid
          && request.resource.data.email == request.resource.data.email.lower();

        // invitee consumes by deleting (preferred). Managers can also delete/manage.
        allow delete: if isManager(teamId)
          || (isSignedIn() && request.auth.token.email_verified == true
              && resource.data.email == request.auth.token.email.lower());

        // optional "mark accepted" path: invitee-only, pending->accepted, other fields pinned
        allow update: if isSignedIn()
          && request.auth.token.email_verified == true
          && resource.data.email == request.auth.token.email.lower()
          && resource.data.status == 'pending'
          && request.resource.data.status == 'accepted'
          && request.resource.data.email == resource.data.email
          && request.resource.data.role == resource.data.role
          && request.resource.data.invitedBy == resource.data.invitedBy;
      }
```

- [ ] **Step 5: Run GREEN** — `npm run test:rules` → all invite tests PASS (Tasks 3–4 still green).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules functions/test-rules/rules.test.ts
git commit -m "feat: invite rules - create, read, atomic accept"
```

---

## Task 6: Rules — projects read/write-deny + cross-team isolation

**Files:** Modify `firestore.rules`; append to `functions/test-rules/rules.test.ts`

- [ ] **Step 1: Append project/isolation tests** to `rules.test.ts`

```typescript
describe("rules: projects + isolation", () => {
  async function seedProjectTree(teamId: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await fs.doc(`teams/${teamId}/projects/web`).set({ title: "Web", status: "running" });
      await fs.doc(`teams/${teamId}/projects/web/phases/p1`).set({ name: "A", order: 1, status: "running" });
      await fs.doc(`teams/${teamId}/projects/web/phases/p1/commits/abc`).set({ message: "m", author: "a" });
    });
  }

  it("members can read project, phase, and commit docs", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "member");
    await seedProjectTree("t1");
    const db = authed("alice");
    await assertSucceeds(db.doc("teams/t1/projects/web").get());
    await assertSucceeds(db.doc("teams/t1/projects/web/phases/p1").get());
    await assertSucceeds(db.doc("teams/t1/projects/web/phases/p1/commits/abc").get());
  });

  it("no client can write project data, even an owner", async () => {
    await seedTeam("t1", "alice");
    await seedMember("t1", "alice", "owner");
    await seedProjectTree("t1");
    const db = authed("alice");
    await assertFails(db.doc("teams/t1/projects/web").set({ title: "x" }));
    await assertFails(db.doc("teams/t1/projects/web/phases/p1").set({ name: "x" }));
  });

  it("cross-team isolation: a member of t1 cannot read t2's projects/members/invites", async () => {
    await seedTeam("t1", "alice"); await seedMember("t1", "alice", "owner");
    await seedTeam("t2", "bob"); await seedMember("t2", "bob", "owner");
    await seedProjectTree("t2");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("teams/t2/invites/i9").set({ email: "x@x.com", role: "member", invitedBy: "bob", status: "pending" });
    });
    const alice = authed("alice");
    await assertFails(alice.doc("teams/t2/projects/web").get());
    await assertFails(alice.doc("teams/t2/members/bob").get());
    await assertFails(alice.doc("teams/t2/invites/i9").get());
  });
});
```

- [ ] **Step 2: Run RED** — `npm run test:rules` → project read tests FAIL (no projects rule yet → default deny; the read-success assertions fail).

- [ ] **Step 3: Add the `projects/{slug}` block** inside `match /teams/{teamId} { ... }`

```
      match /projects/{slug} {
        allow read: if isMember(teamId);
        allow write: if false;
        match /{document=**} {
          allow read: if isMember(teamId);
          allow write: if false;
        }
      }
```

- [ ] **Step 4: Run GREEN** — `npm run test:rules` → all tests PASS.

- [ ] **Step 5: Full verification**

Run:
```bash
cd functions
lsof -ti tcp:8080 | xargs kill 2>/dev/null
npm run build          # clean
npm test               # full API suite green
npm run test:rules     # full rules suite green
```
Expected: build clean, both suites green.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules functions/test-rules/rules.test.ts
git commit -m "feat: project read rules + cross-team isolation"
```

---

## Task 7: Update README for the multi-tenant paths

**Files:** Modify `README.md`

- [ ] **Step 1: Update the API surface + auth sections**

- Change the three endpoint paths in the table to `/v1/teams/{teamId}/projects/{slug}[/phases/{phaseId}[/commits/{sha}]]`.
- Add a short "Teams & access" subsection: teams own projects; membership (owner/admin/member) governs access; reads gated by membership; `isAllowed` is the global entry gate; team/member/invite management happens in the UI via Firestore rules.
- Note that per-user API keys + membership-based write authorization are coming in the next iteration (Sub-project B); today writes still use the shared `AUTOLOOP_WRITE_KEYS`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for team-scoped API paths"
```

---

## Done criteria

- `npm test` (API suite) and `npm run test:rules` both pass; `npm run build` is clean.
- Agent writes go to `/v1/teams/{teamId}/projects/{slug}/...` and 404 on a missing team.
- `firestore.rules` implements: team CRUD, sequential bootstrap, membership reverse-read, role-escalation-safe member updates, atomic invite-accept, manager-only invite create, membership-scoped project reads, all client writes to `projects/**` denied, and cross-team isolation — each covered by a rules test.
- The `collectionGroup` index on `members.uid` is declared for deploy.
- Shared-key auth remains as the documented stopgap; per-user keys + write authz are Sub-project B.
