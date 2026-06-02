# Daloop Per-User API Keys & Write Authorization (Sub-project B) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase)

## Context

Sub-project A made Daloop multi-tenant (teams own projects; membership-scoped
reads) but left agent writes gated by a single shared `DALOOP_WRITE_KEYS` — any
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

- **`requireUser`** — verifies the caller's Firebase ID token with the Admin SDK
  (`getAuth().verifyIdToken`), checks `users/{uid}.isAllowed == true`, and sets
  `req.uid`. Used by the human-facing key-management endpoints.
- **`requireApiKeyMember`** — replaces the old shared-key `requireWriteKey`.
  Hashes the presented API key, looks up `apiKeys/{hash}` → `uid`, then checks
  membership in the `:teamId` from the path. Mounted on the team route subtree
  (with `mergeParams`) so it can see `teamId`, not blanket-applied to all `/v1`.

The old shared-key middleware, the `DALOOP_WRITE_KEYS` env/secret, and the
constant-time-compare machinery are removed (lookup is now a hash equality on a
document id, not a secret comparison).

## Data model

```
apiKeys/{keyHash}            // keyHash = SHA-256(plaintext) hex — the document ID
  ├─ uid:       string       // owner
  ├─ label:     string       // human name, e.g. "claude-laptop"
  ├─ prefix:    string       // first ~8 chars of the plaintext, for display ("dl_ab12c")
  ├─ createdAt: Timestamp
```

- **Key format:** `dl_` + 32 random bytes encoded base64url.
- The **plaintext is returned once** at creation and never stored — only its
  SHA-256 hash (as the doc ID) and the display `prefix` are persisted.
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
| `POST /v1/keys` | Mint. Body `{ label }` (non-empty, max ~100 chars). Generates `dl_…`, stores `apiKeys/{hash}` with `uid`/`label`/`prefix`/`createdAt`. Returns `{ id, key, label, prefix, createdAt }` — `key` (plaintext) is shown **only here**. |
| `GET /v1/keys` | List the caller's keys: `[{ id, label, prefix, createdAt }]`. Never returns the plaintext or anything reversible beyond `prefix`. |
| `DELETE /v1/keys/{id}` | Revoke. `{id}` is the keyHash. Verifies the doc's `uid == caller` before deleting; `404` if not found or not owned by the caller. |

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

- `label` validated with Zod (non-empty string, max length).
- Envelope unchanged; **new code `forbidden` (403)** for the not-a-member case.
- `401` for missing/invalid API key (write path) and missing/invalid ID token
  (key endpoints); `404` for revoking a nonexistent/not-owned key.

## Testing

- **Unit:** key generation + SHA-256 hashing (stable hash; plaintext never
  persisted); `dl_` format and `prefix` extraction; `label` validation.
- **Emulator + Supertest — key endpoints:** mint returns plaintext once and
  persists only the hash; list returns the caller's keys without plaintext;
  revoke is owner-scoped (cannot revoke another user's key → 404); all reject a
  missing/invalid ID token (401).
- **Emulator + Supertest — write path:** with a minted key whose user is a team
  member, a write succeeds; valid key but non-member team → 403; unknown/revoked
  key → 401; end-to-end project → phase → commit under a real key.
- **Rules test:** `apiKeys/**` denies all client reads and writes.
- **ID-token verification in tests:** use the **Firebase Auth emulator** so
  `verifyIdToken` runs against real (emulator-issued) tokens end-to-end; wire it
  into `firebase.json` emulators and the test harness. (Fallback if that proves
  awkward: a thin, injectable token-verifier seam stubbed in tests — decided in
  planning.)

## Out of scope

- The UI / admin console (calls these endpoints after Google sign-in).
- Key expiry/rotation policies, per-user key limits, and `lastUsedAt` auditing.
- Rate limiting and write quotas (future hardening).
- Changing the read path (still Firestore listeners + membership rules from
  Sub-project A).
