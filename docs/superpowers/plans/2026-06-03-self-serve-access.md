# Self-serve Access (request → approve) Implementation Plan (#7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual allowlisting with a self-serve flow: a signed-in (not-yet-allowed) user submits an access request from the waiting room (rules-allowed self-write to `accessRequests/{uid}`), and an admin approves/denies in one click from `/admin` (server sets `users/{uid}.isAllowed`).

**Architecture:** The request is a self-scoped client write gated by a new `accessRequests/{uid}` rules block (the requester isn't `isAllowed`, so server write paths can't serve them — mirrors team member-accept). Approval/denial extends the existing `makeRequireAdmin`-gated `adminRouter` (Admin SDK, atomic set of `isAllowed` + request status). Web adds a "Request access" action to `RequestAccess.tsx` and an "Access requests" panel to `AdminPage.tsx`. No new auth variant.

**Tech Stack:** TypeScript Cloud Function (Express + firebase-admin + zod), `@firebase/rules-unit-testing`, Vitest + Firestore emulator (`functions/`); React + Firebase client SDK + Vitest/jsdom (`web/`). No new deps.

**Reference spec:** `docs/superpowers/specs/2026-06-03-self-serve-access-design.md`

---

## Background / conventions (read before Task 1)

- **`accessRequests/{uid}`** doc id IS the requester's uid (one active request/user): `{ uid, email, note?, status: "pending"|"approved"|"denied", requestedAt }`.
- **Admin API** (`functions/src/routes/admin.ts`) is already mounted at `/v1/admin` under `makeRequireAdmin`; its tests (`functions/test/admin.test.ts`) stub auth with `a.use((req,_res,next)=>{ req.uid="boss"; next(); })` then mount `adminRouter` — i.e. the gate is bypassed in these tests, so they cover the router logic, NOT the 403. (The 403 is already covered by `requireAdmin` tests; don't re-test it here.)
- **Admin web client** (`web/src/admin/client.ts`) uses `BASE`, `headers()` (ID token), `parse()`. Mirror it for the new calls.
- **Requester self-write** uses the Firebase **client SDK** directly (`setDoc(doc(db,"accessRequests",uid), …)`), allowed by the new rule — NOT a server endpoint. `web/src/firebase.ts` exports `db` + `auth`. `AuthProvider` already `onSnapshot`s `users/{uid}`, so when an admin flips `isAllowed` the waiting room auto-advances (no extra wiring).
- **Rules helper** `isSignedIn()` exists (`request.auth != null`). Rules tests use `authed(uid)` + `assertSucceeds`/`assertFails` + `withSecurityRulesDisabled` seeding (`functions/test-rules/rules.test.ts`).
- **Commands:** `cd functions && npm test` (full, emulator) / `npm run test:rules` / `npm run build`. `cd web && npm test` / `npm run build`. Do NOT `git add -A`.
- **Deploy** (bundled with #6): functions + firestore:rules + hosting.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `functions/src/routes/admin.ts` | add GET access-requests + POST :uid decision | 1 |
| `functions/test/admin.test.ts` | Supertest for the new endpoints | 1 |
| `firestore.rules` | add `match /accessRequests/{uid}` block | 2 |
| `functions/test-rules/rules.test.ts` | rules tests for accessRequests | 2 |
| `web/src/admin/client.ts`, `web/src/admin/types.ts` | `listAccessRequests`, `decideAccessRequest` | 3 |
| `web/src/admin/AdminPage.tsx` (+ a component) | "Access requests" panel | 3 |
| `web/src/routes/RequestAccess.tsx` | "Request access" action + pending state | 4 |

---

## Task 1: Admin endpoints — list + approve/deny

**Files:** Modify `functions/src/routes/admin.ts`, `functions/test/admin.test.ts`.

- [ ] **Step 1: Write failing tests** (append to `functions/test/admin.test.ts`'s describe)

```typescript
  it("GET /access-requests lists only pending", async () => {
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    await db().doc("accessRequests/u2").set({ uid: "u2", email: "u2@x.com", status: "approved" });
    const res = await request(app()).get("/v1/admin/access-requests");
    expect(res.status).toBe(200);
    expect(res.body.requests.map((r: any) => r.uid)).toEqual(["u1"]);
  });
  it("approve flips isAllowed and marks the request approved", async () => {
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    await db().doc("users/u1").set({ email: "u1@x.com", isAllowed: false, isAdmin: false });
    expect((await request(app()).post("/v1/admin/access-requests/u1").send({ decision: "approve" })).status).toBe(200);
    expect((await db().doc("users/u1").get()).data()!.isAllowed).toBe(true);
    expect((await db().doc("users/u1").get()).data()!.isAdmin).toBe(false); // untouched
    expect((await db().doc("accessRequests/u1").get()).data()!.status).toBe("approved");
  });
  it("approve provisions a users doc for an un-provisioned uid (with the request email)", async () => {
    await db().doc("accessRequests/u3").set({ uid: "u3", email: "u3@x.com", status: "pending" });
    await request(app()).post("/v1/admin/access-requests/u3").send({ decision: "approve" });
    expect((await db().doc("users/u3").get()).data()).toMatchObject({ isAllowed: true, email: "u3@x.com" });
  });
  it("deny marks denied and leaves isAllowed alone", async () => {
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    await db().doc("users/u1").set({ email: "u1@x.com", isAllowed: false });
    expect((await request(app()).post("/v1/admin/access-requests/u1").send({ decision: "deny" })).status).toBe(200);
    expect((await db().doc("accessRequests/u1").get()).data()!.status).toBe("denied");
    expect((await db().doc("users/u1").get()).data()!.isAllowed).toBe(false);
  });
  it("404 when the request does not exist; 400 on a bad decision", async () => {
    expect((await request(app()).post("/v1/admin/access-requests/ghost").send({ decision: "approve" })).status).toBe(404);
    await db().doc("accessRequests/u1").set({ uid: "u1", email: "u1@x.com", status: "pending" });
    expect((await request(app()).post("/v1/admin/access-requests/u1").send({ decision: "bogus" })).status).toBe(400);
  });
```

- [ ] **Step 2: Run → fail** — `cd functions && npm test -- admin` (use the emulator-backed `npm test`; the `-- admin` filter passes to vitest via `test:run` if you prefer a running emulator).

- [ ] **Step 3: Implement** (`functions/src/routes/admin.ts`) — add after the existing routes (reuse the `UID` regex + `db` + `AppError`):

```typescript
import { FieldValue } from "firebase-admin/firestore";
// (existing imports: Router, z, db, AppError, UID, putBody …)

const decisionBody = z.object({ decision: z.enum(["approve", "deny"]) });

adminRouter.get("/access-requests", async (_req, res, next) => {
  try {
    const q = await db().collection("accessRequests").where("status", "==", "pending").get();
    res.status(200).json({
      requests: q.docs.map((d) => ({ uid: d.id, ...(d.data() as object) })),
    });
  } catch (err) { next(err); }
});

adminRouter.post("/access-requests/:uid", async (req, res, next) => {
  try {
    const uid = req.params.uid;
    if (!UID.test(uid)) throw new AppError(400, "validation", "invalid uid");
    const parsed = decisionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const reqRef = db().doc(`accessRequests/${uid}`);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) throw new AppError(404, "not_found", "access request not found");

    const batch = db().batch();
    if (parsed.data.decision === "approve") {
      const email = reqSnap.data()!.email as string | undefined;
      const userData: Record<string, unknown> = { isAllowed: true };
      if (email !== undefined) userData.email = email;
      batch.set(db().doc(`users/${uid}`), userData, { merge: true }); // never touches isAdmin
      batch.set(reqRef, { status: "approved", decidedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      batch.set(reqRef, { status: "denied", decidedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run → pass** — `cd functions && npm test -- admin` (5 new + existing green).
- [ ] **Step 5: Commit** — `git add functions/src/routes/admin.ts functions/test/admin.test.ts && git commit -m "feat(api): admin access-request list + approve/deny endpoints"`.

---

## Task 2: Firestore rules for `accessRequests`

**Files:** Modify `firestore.rules`, `functions/test-rules/rules.test.ts`.

- [ ] **Step 1: Add the rules block** — at the **top level** inside `match /databases/{database}/documents` (a sibling of `match /users`, `match /apiKeys`, `match /teams`):

```
match /accessRequests/{uid} {
  allow read:   if isSignedIn() && request.auth.uid == uid;
  allow create: if isSignedIn() && request.auth.uid == uid
                && request.resource.data.uid == uid
                && request.resource.data.status == 'pending';
  allow update, delete: if false;
}
```

- [ ] **Step 2: Add rules tests** (new describe in `functions/test-rules/rules.test.ts`)

```typescript
describe("rules: accessRequests", () => {
  it("a signed-in user can create their own pending request and read it", async () => {
    const db = authed("newbie");
    await assertSucceeds(db.doc("accessRequests/newbie").set({ uid: "newbie", email: "n@x.com", status: "pending" }));
    await assertSucceeds(db.doc("accessRequests/newbie").get());
  });
  it("cannot create a request for another uid, or with non-pending status", async () => {
    const db = authed("newbie");
    await assertFails(db.doc("accessRequests/someoneelse").set({ uid: "someoneelse", status: "pending" }));
    await assertFails(db.doc("accessRequests/newbie").set({ uid: "newbie", status: "approved" }));
  });
  it("cannot read someone else's request, nor update/delete own", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("accessRequests/alice").set({ uid: "alice", status: "pending" });
    });
    await assertFails(authed("newbie").doc("accessRequests/alice").get());
    await assertFails(authed("alice").doc("accessRequests/alice").update({ status: "approved" }));
    await assertFails(authed("alice").doc("accessRequests/alice").delete());
  });
});
```

(Confirm `authed`, `assertSucceeds`, `assertFails`, `testEnv` are in scope — they are, used throughout the file.)

- [ ] **Step 3: Run → pass** — `cd functions && npm run test:rules` (new + existing green).
- [ ] **Step 4: Commit** — `git add firestore.rules functions/test-rules/rules.test.ts && git commit -m "feat(rules): self-scoped accessRequests (owner create-pending/read; no client update)"`.

---

## Task 3: Web admin — list + approve/deny panel

**Files:** Modify `web/src/admin/client.ts`, `web/src/admin/types.ts`, `web/src/admin/AdminPage.tsx`; (optional) a small `web/src/admin/components/AccessRequests.tsx`.

- [ ] **Step 1: Add the client calls** (`web/src/admin/client.ts`) — mirror `listUsers`/`setAllowed`:

```typescript
export interface AccessRequest { uid: string; email?: string; note?: string; status: string; }
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const res = await fetch(`${BASE}/v1/admin/access-requests`, { headers: await headers() });
  return (await parse<{ requests: AccessRequest[] }>(res)).requests;
}
export async function decideAccessRequest(uid: string, decision: "approve" | "deny"): Promise<void> {
  const res = await fetch(`${BASE}/v1/admin/access-requests/${uid}`, {
    method: "POST", headers: await headers(), body: JSON.stringify({ decision }),
  });
  await parse<unknown>(res);
}
```
(Put `AccessRequest` in `types.ts` if you prefer; either is fine.)

- [ ] **Step 2: Add the panel** (`AdminPage.tsx`) — load `listAccessRequests()` on mount (alongside the existing users load); render an "Access requests" section listing pending requests (email + note) with **Approve**/**Deny** buttons → `decideAccessRequest(uid, …)` then refresh both lists. Empty state "No pending requests." Errors via the existing admin error note. Follow the existing AdminPage state/handler idiom (`useState` + async refresh).

- [ ] **Step 3: (optional) component test** — if you extract `AccessRequests.tsx` (presentational: `{ requests, onApprove, onDeny }`), add a render test (mocked handlers) asserting it lists a request and the Approve button calls `onApprove(uid)`. Keep consistent with the existing admin component tests if any; otherwise a small test is good coverage.

- [ ] **Step 4: Build + tests** — `cd web && npm run build && npm test` → clean + green.
- [ ] **Step 5: Commit** — `git add web/src/admin/ && git commit -m "feat(web): admin access-requests approve/deny panel"`.

---

## Task 4: Web requester — "Request access" + pending state

**Files:** Modify `web/src/routes/RequestAccess.tsx` (+ optionally a tiny `requestAccess` helper).

- [ ] **Step 1: Implement** — `RequestAccess.tsx` currently shows uid/email + sign-out. Add:
  - Subscribe (onSnapshot) to `doc(db, "accessRequests", user.uid)` → local state `request: {status} | null`.
  - If no request: a **"Request access"** button (+ an optional note `<textarea>`) → on click `setDoc(doc(db,"accessRequests",user.uid), { uid: user.uid, email: user.email ?? "", note, status: "pending", requestedAt: serverTimestamp() })` (import `doc`, `setDoc`, `serverTimestamp`, `onSnapshot` from `firebase/firestore`; `db` from `../firebase` — match `AuthProvider.tsx`'s imports).
  - If `status === "pending"`: show "Request submitted — an admin will review it." If `"denied"`: show "Your request was denied. Contact an admin." (and allow re-request). Submit errors surface inline; never crash.
  - (No change needed for approval: when `isAllowed` flips, `AuthProvider`'s `users/{uid}` subscription advances the app automatically.)

- [ ] **Step 2: Test** (`web/src/routes/screens.test.tsx` or a new RequestAccess test) — render `RequestAccess` (the file imports `useAuth`; mock it to return a user). Since the component now uses the Firestore SDK, either (a) extract the form into a presentational `RequestAccessCard({ email, uid, status, onRequest })` and test THAT with a mocked `onRequest` (preferred — keeps the SDK out of the test), or (b) mock `firebase/firestore`. Prefer (a): assert the button shows when `status` is null and calls `onRequest`, and that "review it" shows when `status==="pending"`.

- [ ] **Step 3: Build + tests** — `cd web && npm run build && npm test` → clean + green.
- [ ] **Step 4: Commit** — `git add web/src/routes/RequestAccess.tsx web/src/routes/*.test.tsx && git commit -m "feat(web): request-access action + pending state in the waiting room"`.

---

## Task 5: Verification

- [ ] `cd functions && npm test` (admin + existing green) ; `npm run build` clean ; `npm run test:rules` green (accessRequests block).
- [ ] `cd web && npm test` + `npm run build` green/clean.
- [ ] Confirm: a signed-in user can self-create a pending request (rules) and not others'; admin GET lists pending; approve flips `isAllowed` (+ provisions a users doc if absent) and marks approved; deny marks denied; the waiting room shows pending and auto-advances on approval (via the existing `AuthProvider` subscription); no change to non-admin server write paths.
- [ ] Final commit if needed. **Deploy (bundled with #6): functions + firestore:rules + hosting.**

---

## Notes for the executor
- The requester is NOT `isAllowed` — the access request MUST be the rules-based client self-write, never a server endpoint (the server paths require isAllowed).
- Approval is **admin-only, server-mediated** (Admin SDK) — it flips `users/{uid}.isAllowed`, which is client-write-forbidden, so a requester can never self-approve. The batch keeps `isAllowed` and request status atomic and **never writes `isAdmin`**.
- Don't re-test the admin 403 in `admin.test.ts` (that file stubs `req.uid`, bypassing the gate); the gate is covered by `requireAdmin` tests.
- Keep the Firestore SDK out of component tests (extract a presentational card with an injected `onRequest`/`onApprove`).
- No new deps. Do NOT `git add -A` (pre-existing untracked `.DS_Store`/`prototype/`).
