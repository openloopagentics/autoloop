# Autoloop — Admin Allowlist (UI-E) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase; decisions delegated to the implementer)

## Context

UI-A–D are merged. The final piece: an **admin** can view all users and grant/revoke
their `users/{uid}.isAllowed` (the global access gate). Until now provisioning was
manual (Firebase console). UI-E gives admins a UI for it.

This spans **backend + frontend**:
- The Firestore rules keep `users/` **client-write-denied** and self-read-only — we
  do NOT loosen them. Instead, admin operations go through a **new authenticated
  admin API** (Firebase ID token + an `isAdmin` check) that uses the Admin SDK
  (which bypasses rules) to read all users and set `isAllowed`. No rules change.
- The frontend adds an `/admin` page (visible only to admins) that calls that API.

## Backend — admin API (`functions/`)

- **`requireAdmin` middleware** (`src/requireAdmin.ts`), built like `requireUser`
  (injectable token verifier for tests): verify the Firebase ID token →
  `getAuth().verifyIdToken`; read `users/{uid}`; require `isAllowed === true` **and**
  `isAdmin === true`; missing/invalid token → 401; authenticated but not admin → 403.
  Sets `req.uid`.
- **`src/routes/admin.ts`** (`adminRouter`):
  - `GET /v1/admin/users` → `{ users: [{ uid, email, isAllowed, isAdmin }] }` — reads
    the whole `users` collection via the Admin SDK (small allowlist; no pagination
    for now).
  - `PUT /v1/admin/users/{uid}` body `{ isAllowed: boolean, email?: string }` →
    **merge-set** `users/{uid}` with `{ isAllowed }` (and `email` if provided). Zod:
    `isAllowed` required boolean, `email` optional string. Merge **creates the doc if
    absent** — this is how an admin grants access to a never-provisioned user (see
    "granting un-provisioned users" below). Does NOT touch `isAdmin`. `uid` validated
    against `^[A-Za-z0-9._-]+$` (Firebase uids are alnum; allow the safe set).
- **`app.ts`:** mount `app.use("/v1/admin", makeRequireAdmin(), adminRouter)` (its own
  auth, like `/v1/keys`'s `requireUser`). The catch-all 404 + errorHandler stay last.
- **First-admin bootstrap (manual, documented):** there's a chicken-and-egg — the
  first admin can't be set via an admin-only API. An owner sets one user's
  `isAdmin: true` once in the Firebase console (or via the Admin SDK). Documented in
  the README; not automated.
- **Guardrails:** `PUT` only changes `isAllowed` (+ optional `email`), never
  `isAdmin` (so the admin API can't mint/strip admins — that stays a console/Admin-SDK
  operation). `requireAdmin` requires `isAllowed === true` AND `isAdmin === true`, so
  an admin who self-revokes their own `isAllowed` immediately loses admin-API access —
  intentional, recoverable via the console (not a bug). Not-allowed and not-admin
  both surface as **403** (shared) — only missing/invalid token is 401.

- **Granting un-provisioned users:** a brand-new signed-in user has **no**
  `users/{uid}` doc, so they don't appear in `GET /v1/admin/users`. The admin grants
  them via a **"grant by UID"** input (uid + email, from what UI-A's request-access
  screen shows the user): `PUT /v1/admin/users/{uid}` with `{ isAllowed: true, email }`
  merge-creates the doc. The per-row toggle alone can't reach users without docs, so
  this input is a first-class part of the page, not optional.

## Backend testing (emulator + Supertest)

- `requireAdmin`: 401 missing/invalid token; 403 when the user doc lacks
  `isAdmin: true` (or isn't allowed); pass-through + `req.uid` when admin. (Injected
  stub verifier, like the `requireUser` tests.)
- `GET /v1/admin/users` returns all seeded users with their flags (admin token).
- `PUT /v1/admin/users/{uid}` sets `isAllowed` (true/false); rejects a non-boolean
  body (400); a non-admin token → 403 (via the middleware).

## Frontend — admin page (`web/`)

- **`AuthProvider` extension:** the `users/{uid}` listener already runs; also expose
  `isAdmin` on the `useAuth()` value, set from `snap.data().isAdmin === true`
  (undefined-safe). **Make `isAdmin` OPTIONAL on `AuthValue` (`isAdmin?: boolean`)** so
  existing UI-A–D test fixtures / App.test inline `AuthValue` keep compiling without
  change; consumers read it as `useAuth().isAdmin === true`.
- **`AppShell` nav:** show an **"Admin"** link only when `useAuth().isAdmin === true`.
- **`/admin` route → `AdminPage`** (thin glue): loads users via the admin client;
  renders the **grant-by-UID input** (uid + email → `setAllowed(uid, true, email)`)
  and a `UserList`; each row's Allow/Revoke toggle calls `setAllowed(uid, next)` then
  refreshes. A non-admin hitting the route gets a 403 from the API → inline message
  (the nav already hides the link).
- **Admin client (`web/src/admin/client.ts`, glue):** `listUsers()` → `body.users`
  (array); `setAllowed(uid, isAllowed, email?)` → `PUT /v1/admin/users/{uid}` with
  `{ isAllowed, ...(email ? { email } : {}) }`. Same same-origin relative base +
  ID-token pattern as `keys/client.ts` (reuses the `/v1/**` Hosting rewrite).
- **Presentational (props-only, tested):** `UserRow({ user, onSetAllowed })` —
  **`email ?? uid`** (email may be absent on an admin-created doc), an `isAllowed`
  indicator, an admin badge, and an Allow/Revoke button emitting
  `onSetAllowed(uid, next)`; `UserList({ users, onSetAllowed })` (rows or empty);
  `GrantByUidForm({ onGrant })` (uid + email inputs → `onGrant(uid, email)`).

## Frontend testing

Vitest + RTL: `UserRow` (renders `email ?? uid` + flags; Allow on a disallowed user
emits `onSetAllowed(uid, true)`; Revoke on an allowed user emits `false`; a doc
without `email` shows the uid); `UserList` empty vs populated; `GrantByUidForm`
emits `onGrant(uid, email)`. Also: `AppShell` shows the Admin link only when
`isAdmin === true` (add an `isAdmin: true` case to the existing AppShell test using
the optional field — other fixtures are unaffected since `isAdmin` is optional).
`admin/client.ts` + `AdminPage` are glue (build-only). **App.test firebase-free:**
`App.tsx` statically imports `AdminPage` → `admin/client.ts` → `firebase.ts`, so add
a hoisted `vi.mock("./admin/client", () => ({ listUsers: () => Promise.resolve([]),
setAllowed: vi.fn() }))` (alongside the existing mocks; `listUsers` resolves to the
array, matching the unwrapped return). Because `isAdmin` is optional on `AuthValue`,
App.test's inline `AuthValue` needs no change.

## Routing

`/admin` → `AdminPage`, under `AppShell`. The Admin nav link is conditional on
`isAdmin`.

## README

Document: the admin allowlist UI at `/admin`; that the **first admin** is bootstrapped
manually (set `users/{uid}.isAdmin = true` in the Firebase console); that the admin
API (`/v1/admin/*`) is ID-token-authed + `isAdmin`-gated and only toggles `isAllowed`
(never `isAdmin`).

## Out of scope

- Self-service admin promotion, audit logging, pagination of a large user list,
  removing the manual first-admin bootstrap.
- Loosening the `users/` Firestore rules (we deliberately keep them locked and route
  through the admin API).
