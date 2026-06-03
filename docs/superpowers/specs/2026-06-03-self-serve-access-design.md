# Daloop — Self-serve access (request → approve) design spec

**Date:** 2026-06-03
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** #7 of the initiative's expanded program. Replaces the manual
allowlisting (admin hand-writes `users/{uid}.isAllowed`) with a self-initiated
**access request → one-click admin approve** flow. Builds on the existing allowlist
gate, the admin API/page, and the security rules.

## Goal

Today a new user signs in, lands in the "waiting room" (`RequestAccess.tsx`) showing
their UID, and an **admin must manually** set `users/{uid}.isAllowed` (the friction we
hit onboarding `ravi@openloopagentics.com`). This adds a **self-serve request**: the
waiting-room user clicks "Request access" (capturing uid + email + an optional note),
and admins **approve/deny with one click** from `/admin`. Still gated; just no manual
UID-copying or Firestore-poking.

## Architecture

The requester is **signed-in but not yet `isAllowed`**, so the existing server write
paths (`requireUser`/`requireApiKeyMember` both require `isAllowed`, `requireMember`
needs membership) all reject them. So the request is a **rules-allowed, self-scoped
client write** to `accessRequests/{uid}` — the same pattern the app already uses for
team member-accept (a client writes its own doc, gated by rules). Approval/denial is
an **admin, server-mediated** action (Admin SDK, `makeRequireAdmin`-gated) that sets
`users/{uid}.isAllowed` — extending the existing admin endpoints. No new auth variant.

## Domain

`accessRequests/{uid}` (doc id IS the requester's uid — one active request per user):
```
{ uid, email, note?, status: "pending" | "approved" | "denied", requestedAt }
```

## Components

### Rules (`firestore.rules`, additive top-level block)

```
match /accessRequests/{uid} {
  allow read:   if isSignedIn() && request.auth.uid == uid;     // see your own status
  allow create: if isSignedIn() && request.auth.uid == uid
                && request.resource.data.uid == uid
                && request.resource.data.status == 'pending';
  allow update, delete: if false;                                // admins decide via Admin SDK
}
```
Notes: only the requester creates **their own** pending request; nobody else reads it
(admins read via the server/Admin SDK, which bypasses rules); clients can't mutate it
(so a requester can't self-approve — approval flips `users/{uid}.isAllowed`, which is
already client-write-forbidden). Re-requesting overwrites the same doc (create on an
existing doc id is a set; acceptable — a re-request resets to pending). Rules tests
assert: owner create(pending)/read; non-owner create/read denied; client update/delete
denied.

### Functions (extend `functions/src/routes/admin.ts`, already `makeRequireAdmin`-gated)

- `GET /v1/admin/access-requests` → `{ requests: [{ uid, email, note?, status, requestedAt }] }`
  for **pending** requests (Admin SDK query `where("status","==","pending")`).
- `POST /v1/admin/access-requests/:uid` body `{ decision: "approve" | "deny" }`:
  - validate uid (existing `UID` regex) + decision (zod enum).
  - **approve:** in one batch/transaction set `users/{uid}.isAllowed = true` (merge,
    never touches `isAdmin` — same guarantee as the existing `PUT /users/:uid`) and
    set `accessRequests/{uid}.status = "approved"`.
  - **deny:** set `accessRequests/{uid}.status = "denied"` (leaves `isAllowed` as-is).
  - 404 if no request doc for that uid. Response `{ ok: true }`.
- Supertest (extends `functions/test/admin.test.ts` pattern): list returns only
  pending; approve flips `isAllowed` + marks approved; deny marks denied without
  allowing; non-admin → 403; unknown uid → 404.

### Web — requester (`web/src/routes/RequestAccess.tsx` + a small client)

- Add a **"Request access"** action: writes `accessRequests/{uid}` via the **Firebase
  client SDK** (`setDoc`, rules-allowed) with `{ uid, email, note, status:"pending",
  requestedAt: serverTimestamp() }` (note via an optional textarea).
- Subscribe (onSnapshot) to the user's own `accessRequests/{uid}`: before requesting,
  show the button; after, show "Request pending — an admin will review it" (or
  "denied" if so). The screen already auto-advances to the app when `isAllowed` flips
  (the auth context re-evaluates), so approval needs no extra wiring here.

### Web — admin (`web/src/admin/AdminPage.tsx` + `web/src/admin/client.ts`)

- `client.ts`: add `listAccessRequests()` (GET) and `decideAccessRequest(uid, decision)`
  (POST), using the existing ID-token `headers()`/`parse()` helpers.
- `AdminPage.tsx`: an **"Access requests"** panel above/with the users table — lists
  pending requests (email + note + relative time) with **Approve** / **Deny** buttons;
  on action, refresh both the requests list and the users list. Empty state when none.

## Data flow

new user signs in → waiting room → "Request access" → client writes
`accessRequests/{uid}` (pending) → admin sees it in `/admin` → Approve →
server sets `users/{uid}.isAllowed=true` + request `approved` → the requester's auth
context sees `isAllowed` flip → app unlocks. (Deny → request `denied`, stays gated.)

## Error handling

- Requester: a failed write surfaces inline ("couldn't submit request — try again");
  never crashes the waiting room.
- Admin: failed approve/deny surfaces via the existing admin-page error note; the batch
  is atomic so `isAllowed` and request status never diverge.

## Testing

- **Rules:** owner create(pending) + read own; non-owner create denied + read denied;
  client update/delete denied. (Add to `functions/test-rules/rules.test.ts`.)
- **Admin API:** GET lists only pending; approve → `users/{uid}.isAllowed===true` +
  request `approved`; deny → request `denied` and `isAllowed` unchanged; non-admin 403;
  missing request 404. (Add to `functions/test/admin.test.ts`.)
- **Web:** RequestAccess submit writes the doc + shows pending (mock the client SDK
  write); AdminPage lists requests + approve calls `decideAccessRequest` (mock client).
- `functions` + `web` builds clean; `npm run test:rules` green.

## Out of scope (deferred)

- Domain-based auto-allow.
- Notifying the requester of the decision by email / in-app (#6 is project-scoped).
- Rate-limiting / abuse controls on requests (a re-request just overwrites the same
  doc; one pending request per uid).
- Self-serve team creation (already available to allowed users on the Teams page).

## Success criteria

- A signed-in, not-yet-allowed user can submit an access request from the waiting room
  (rules-allowed self-write) and see it pending; cannot read or create anyone else's;
  cannot self-approve.
- An admin sees pending requests in `/admin` and approves/denies in one click; approve
  flips `isAllowed` (the user gains access without manual Firestore edits); deny marks
  the request and leaves access gated.
- Rules / admin-API / web suites green; no change to non-admin server write paths.
