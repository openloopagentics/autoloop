# Autoloop Per-User API Keys & Write Authorization (Sub-project B) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase)

## Context

Sub-project A made Autoloop multi-tenant (teams own projects; membership-scoped
reads) but left agent writes gated by a single shared `AUTOLOOP_WRITE_KEYS` — any
holder of that key can write to any team. Sub-project B closes that gap:

- Users mint **per-user API keys** (the key acts as its user).
- Agent writes are authorized by resolving `API key → user → team membership`.
- The shared key and its middleware are **removed**.

This builds on:
- `docs/superpowers/specs/2026-06-01-rest-api-design.md` (single-tenant API)
- `docs/superpowers/specs/2026-06-01-multitenant-foundation-design.md` (teams/members)

The UI is out of scope. Key management is exposed as API endpoints the UI calls
after Google sign-in.

## Architecture: a second auth mode

`/v1` now has two route groups with different middleware:

```
/v1/keys/**                              → requireUser          (Firebase ID token)
/v1/teams/:teamId/projects/**            → requireApiKeyMember   (API key → user → membership)
```

- **`requireUser`** (net-new middleware — there is no existing server-side ID-token
  path; Sub-project A did all human auth in Firestore rules) — verifies the caller's
  Firebase ID token via the Admin SDK (`getAuth().verifyIdToken`, importing `getAuth`
  from `firebase-admin/auth`), checks `users/{uid}.isAllowed == true`, sets `req.uid`.
- **`requireApiKeyMember`** (net-new; replaces the old shared-key `requireWriteKey`) —
  hashes the presented API key, looks up `apiKeys/{hash}` → `uid`, then checks
  membership in the `:teamId` from the path.

### Concrete mounting (against the real `app.ts`)

Today `app.ts` mounts three sibling routes plus a blanket `app.use("/v1", requireWriteKey)`.
This is restructured to:

```
const keysRouter = Router();                       // requireUser applied here
app.use("/v1/keys", requireUser, keysRouter);

const teamRouter = Router({ mergeParams: true });  // requireApiKeyMember applied here
teamRouter.use("/:slug/phases/:phaseId/commits", commitsRouter);
teamRouter.use("/:slug/phases", phasesRouter);
teamRouter.use("/:slug", projectsRouter);          // careful ordering: most-specific first
app.use("/v1/teams/:teamId/projects", requireApiKeyMember, teamRouter);
// catch-all 404 + errorHandler remain LAST
```

(Equivalent alternative: apply `requireApiKeyMember` inline on each of the three existing
`app.use("/v1/teams/:teamId/projects...")` lines. Either is fine; the parent-router form
keeps the auth in one place. The implementer picks whichever is cleaner, but the three
project/phase/commit routers and their `mergeParams` behavior must be preserved exactly.)

### Invariant: no blanket `/v1` guard

The blanket `app.use("/v1", requireWriteKey)` is **removed**. Each route group declares
its own middleware (`requireUser` for `/v1/keys`, `requireApiKeyMember` for the team
subtree). Consequently the **catch-all 404 is intentionally unauthenticated** — an unknown
`/v1/whatever` returns the 404 envelope without needing a key, which is correct. There are
no other `/v1` write paths today; any future one MUST declare its own auth (it will not be
protected by default).

### Removed in this sub-project

- The shared-key `requireWriteKey` middleware and the constant-time-compare machinery in
  `auth.ts` (lookup is now a hash equality on a document id, not a secret comparison). The
  key-extraction helper (`extractKey`) is **reused** by `requireApiKeyMember`.
- `index.ts`: drop `defineSecret("AUTOLOOP_WRITE_KEYS")` and the `secrets: [writeKeys]` option
  on `onRequest`.
- After rollout, **decommission the deployed Functions secret** (`firebase functions:secrets:destroy AUTOLOOP_WRITE_KEYS`).
- `auth.test.ts` (which unit-tests the deleted `isValidKey`/`requireWriteKey`) is deleted or
  rewritten against the new middleware; `helpers.ts` drops the `AUTOLOOP_WRITE_KEYS` env line.

## Data model

```
apiKeys/{keyHash}            // keyHash = SHA-256(plaintext) hex — the document ID
  ├─ uid:       string       // owner
  ├─ label:     string       // human name, e.g. "claude-laptop"
  ├─ prefix:    string       // first ~8 chars of the plaintext, for display ("al_ab12c")
  ├─ createdAt: Timestamp
```

- **Key format:** `al_` + 32 random bytes encoded base64url.
- The **plaintext is returned once** at creation and never stored — only its
  SHA-256 hash (as the doc ID) and the display `prefix` are persisted. The hash
  input is the **full plaintext including the `al_` prefix** (so tests pin the
  exact preimage), hex-encoded.
- **Write-path lookup** is an O(1) `get(apiKeys/{hash})`.
- **Listing** is `apiKeys where uid == caller` — Firestore auto-indexes single
  fields, so no declared composite index is needed.
- **Revocation id:** the API uses the **keyHash as the opaque id** in list and
  revoke responses. This is safe: a hash cannot be reversed to forge a write
  (the write path requires the plaintext preimage), so exposing it to its owner
  leaks nothing usable.
- No `lastUsedAt` — tracking it would add a Firestore write per agent request
  (cost + latency). Revocation, not staleness, is the safety lever.

## Key-management endpoints (`/v1/keys`)

All require a valid Firebase ID token (`Authorization: Bearer <idToken>`) and
`isAllowed`. Errors use the existing `{ error: { code, message } }` envelope.

| Method & path | Behavior |
|---|---|
| `POST /v1/keys` | Mint. Body `{ label }` — trimmed, non-empty, **max 100 chars**; duplicate labels allowed (keys are identified by hash, not label). Generates `al_…`, stores `apiKeys/{hash}` with `uid`/`label`/`prefix`/`createdAt`. Returns `{ id, key, label, prefix, createdAt }` — `key` (plaintext) is shown **only here**. |
| `GET /v1/keys` | List the caller's keys: `[{ id, label, prefix, createdAt }]`. Never returns the plaintext or anything reversible beyond `prefix`. |
| `DELETE /v1/keys/{id}` | Revoke. `{id}` is the keyHash. `get` the doc, verify `uid == caller`, then `delete`; `404` if not found or not owned. The get-then-delete is not transactional and doesn't need to be — a concurrent double-revoke is harmless (the second is a no-op / 404). |

`id` in every response is the keyHash. If a mint response is lost, the user
revokes and mints a new key.

## Write-path authorization

`requireApiKeyMember`, applied to `/v1/teams/:teamId/...`:

1. Extract the key — `Authorization: Bearer <key>` canonical, `x-api-key`
   fallback (same extraction logic as the current middleware).
2. SHA-256 the key; `get(apiKeys/{hash})`. Missing → **`401 unauthorized`**.
3. Read `uid`; `get(teams/{teamId}/members/{uid})`. Not a member →
   **`403 forbidden`** (new `code: "forbidden"` in the envelope).
4. Set `req.uid`; the existing project/phase/commit services run unchanged
   (they already 404 on a missing team/project/phase).

So: unknown/revoked key → 401; valid key whose user isn't on the team → 403.

This is two reads per write (`apiKeys/{hash}`, then the member doc) — both plain
`get`s, no transaction needed (it's a read-only authorization check; the actual
mutation happens later in the service's own transaction).

## Security rules

Add to `firestore.rules`:

```
match /apiKeys/{keyHash} {
  allow read, write: if false;   // hashes; managed only by the API (Admin SDK)
}
```

Clients never touch `apiKeys`. Listing returns metadata through the API, not via
client reads. (The Admin SDK bypasses rules, so the API still reads/writes it.)

## Validation & errors

- `label` validated with Zod (trimmed, non-empty string, max 100 chars).
- Envelope unchanged; **new code `forbidden` (403)** for the not-a-member case.
- `401` for missing/invalid API key (write path) and missing/invalid ID token
  (key endpoints); `404` for revoking a nonexistent/not-owned key.

### Reworking the existing shared-key tests (required migration)

The current suite is built around the shared key and must be migrated:

- `test/helpers.ts`: `authHeader()` currently returns `Bearer test-key`. It is
  reworked to **mint a real per-user key** — write an `apiKeys/{hash}` doc (via the
  Admin SDK) for a test uid and return `Bearer <plaintext>`. Add a companion helper
  to seed that uid as a member of the team under test (`teams/{teamId}/members/{uid}`),
  since writes now require membership (403 otherwise). Remove the
  `AUTOLOOP_WRITE_KEYS ??= "test-key"` line.
- `test/projects.test.ts`, `phases.test.ts`, `commits.test.ts`, `integration.test.ts`:
  every write test must now seed the key's user as a team member (in addition to the
  existing `seedTeam`). The auth-related assertions still hold (401 without a key).
- `test/auth.test.ts`: targets the deleted `extractKey`/`isValidKey`/`requireWriteKey`.
  Keep+repurpose the `extractKey` tests (it's reused), delete the `isValidKey`/
  `requireWriteKey` tests, and add tests for the new middleware behavior.

### New tests

- **Unit:** key generation + SHA-256 hashing (stable hash over the full `al_…`
  plaintext; plaintext never persisted); `al_` format and `prefix` extraction;
  `label` validation (trim, non-empty, max 100).
- **`requireUser` unit tests via an injectable verifier seam (lead with this):**
  `requireUser` takes its token-verifier as an injected dependency (default =
  `getAuth().verifyIdToken`), so unit tests stub it to return a uid without any
  emulator/token plumbing. This is the primary way `requireUser` is tested — it
  avoids the custom-token-exchange dance, the single most likely thing to stall
  implementation.
- **Emulator + Supertest — key endpoints:** mint persists only the hash and returns
  plaintext once; list returns the caller's keys without plaintext; revoke is
  owner-scoped (cannot revoke another user's key → 404); missing/invalid token → 401.
  These inject a stub verifier (or pass a known uid) rather than minting real tokens.
- **Emulator + Supertest — write path:** minted key whose user is a team member →
  write succeeds; valid key, non-member team → 403; unknown/revoked key → 401;
  end-to-end project → phase → commit under a real key.
- **Rules test:** `apiKeys/**` denies all client reads and writes.
- **One Auth-emulator end-to-end happy path (optional, nice-to-have):** if time
  permits, wire the Firebase **Auth emulator** into `firebase.json` (add an `auth`
  block) and set `FIREBASE_AUTH_EMULATOR_HOST` in the harness before the Admin SDK
  initializes, mint a real ID token (custom token → `signInWithCustomToken` REST
  exchange), and verify one `/v1/keys` call end-to-end through the real
  `verifyIdToken`. The seam-based tests above are the source of truth; this is a
  single confidence check, not the primary coverage.

## Out of scope

- The UI / admin console (calls these endpoints after Google sign-in).
- Key expiry/rotation policies, per-user key limits, and `lastUsedAt` auditing.
- Rate limiting and write quotas (future hardening).
- Changing the read path (still Firestore listeners + membership rules from
  Sub-project A).
