# Daloop — Admin Allowlist (UI-E) — Design

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
  - `PUT /v1/admin/users/{uid}` body `{ isAllowed: boolean }` → merge-sets
    `users/{uid}.isAllowed`. Zod-validate the body (boolean required). Does NOT touch
    `isAdmin`. `uid` validated against a safe pattern.
- **`app.ts`:** mount `app.use("/v1/admin", makeRequireAdmin(), adminRouter)` (its own
  auth, like `/v1/keys`'s `requireUser`). The catch-all 404 + errorHandler stay last.
- **First-admin bootstrap (manual, documented):** there's a chicken-and-egg — the
  first admin can't be set via an admin-only API. An owner sets one user's
  `isAdmin: true` once in the Firebase console (or via the Admin SDK). Documented in
  the README; not automated.
- **Guardrails:** `PUT` only changes `isAllowed`, never `isAdmin` (so the admin API
  can't mint/strip admins — that stays a console/Admin-SDK operation). An admin
  setting their own `isAllowed: false` is permitted (they can still be re-allowed via
  console); not specially blocked.

## Backend testing (emulator + Supertest)

- `requireAdmin`: 401 missing/invalid token; 403 when the user doc lacks
  `isAdmin: true` (or isn't allowed); pass-through + `req.uid` when admin. (Injected
  stub verifier, like the `requireUser` tests.)
- `GET /v1/admin/users` returns all seeded users with their flags (admin token).
- `PUT /v1/admin/users/{uid}` sets `isAllowed` (true/false); rejects a non-boolean
  body (400); a non-admin token → 403 (via the middleware).

## Frontend — admin page (`web/`)

- **`AuthProvider` extension:** the `users/{uid}` listener already runs; also expose
  `isAdmin` (`snap.data().isAdmin === true`) on the `useAuth()` value. (Add `isAdmin`
  to `AuthValue`; default `false`.)
- **`AppShell` nav:** show an **"Admin"** link only when `useAuth().isAdmin` is true.
- **`/admin` route → `AdminPage`** (thin glue): loads users via an admin client and
  renders a list; each `UserRow` shows email/uid/flags + an Allow/Revoke toggle that
  calls `setAllowed(uid, next)` then refreshes. If a non-admin somehow hits the route,
  the API returns 403 → shown as an inline message (the nav already hides it).
- **Admin client (`web/src/admin/client.ts`, glue):** `listUsers()` →
  `body.users`; `setAllowed(uid, isAllowed)` → `PUT /v1/admin/users/{uid}`. Same
  same-origin relative base + ID-token pattern as `keys/client.ts` (reuses the
  `/v1/**` Hosting rewrite from UI-D).
- **Presentational (props-only, tested):** `UserRow({ user, onSetAllowed })` —
  email/uid, an `isAllowed` indicator, an admin badge, and an Allow/Revoke button
  emitting `onSetAllowed(uid, next)`; `UserList({ users, onSetAllowed })` (rows or
  empty).

## Frontend testing

Vitest + RTL: `UserRow` (renders flags; Allow button on a disallowed user emits
`onSetAllowed(uid, true)`; Revoke on an allowed user emits `false`); `UserList`
empty vs populated. Also: `AppShell` shows the Admin link only when `isAdmin` (extend
the existing AppShell test with an `isAdmin` context value). `admin/client.ts` +
`AdminPage` are glue (build-only). **App.test firebase-free:** `App.tsx` statically
imports `AdminPage` → `admin/client.ts` → `firebase.ts`, so add a hoisted
`vi.mock("./admin/client", () => ({ listUsers: () => Promise.resolve([]), setAllowed: vi.fn() }))`
(alongside the existing mocks). The AuthProvider `isAdmin` addition needs no new test
(glue), but update the AppShell test's context fixture to include `isAdmin`.

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
