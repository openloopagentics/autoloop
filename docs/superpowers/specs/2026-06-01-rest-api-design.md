# Daloop REST API — Design

**Date:** 2026-06-01
**Status:** Approved (design phase)

## Context

Daloop is a frontend that displays the status of many projects being developed
in a loop by AI agents. Each project has a design, a set of phases, and the
commits made during those phases. This spec covers **the REST API only** — the
write surface that AI agents (Claude Code, Codex) call, via a skill, to report
status as the loop executes.

Reads are out of scope for the REST API: the website subscribes to Firestore
directly with real-time listeners. Read access is gated by Google sign-in and
an allowlist (see Auth & security). The website itself (UI) is a separate
concern with its own spec.

## Architecture

```
AI agents (Claude/Codex via a skill)
   │  API key (write)  — idempotent PUT upserts
   ▼
Cloud Functions REST API (write-only)
   │  validation + denormalization bookkeeping
   │  Firebase Admin SDK (bypasses security rules)
   ▼
Firestore  (projects / phases / commits, users)
   ▲
   │  real-time listeners
   │  Firebase Auth (Google) + isAllowed allowlist, read-only via rules
Website (separate app, Firebase client SDK)
```

Key decisions:

- **Runtime:** Firebase Cloud Functions, Express-style, using the Firebase
  Admin SDK to write Firestore.
- **Write-only API.** All reads happen through Firestore real-time listeners
  from the website. The API exposes no read endpoints.
- **Uniform idempotent PUT upserts.** Every write targets a document by a
  client-supplied ID (`slug`, `phaseId`, `sha`) and uses merge-upsert
  semantics. Retries are always safe and never duplicate.
- **Agent stays dumb.** The API owns all denormalized/derived bookkeeping
  (`currentPhaseId`, `updatedAt`, `startedAt`, `endedAt`) so agents only report
  the event that occurred.

## Data model (Firestore)

Nested collections mirror the hierarchy `project → phases → commits`. A
top-level `users` collection backs the read allowlist.

```
projects/{slug}
  ├─ slug:            string   (client-supplied ID, e.g. "acme-web")
  ├─ title:           string
  ├─ status:          Status
  ├─ design:          Design | null   (optional; may be added by a later write)
  ├─ currentPhaseId:  string | null   (server-owned; denormalized for the UI)
  ├─ createdAt:       Timestamp        (server-stamped on first write)
  ├─ updatedAt:       Timestamp        (server-stamped on every write)
  │
  ├─ phases/{phaseId}                  (phaseId is client-supplied)
  │    ├─ name:       string
  │    ├─ order:      number           (client-supplied)
  │    ├─ status:     Status
  │    ├─ startedAt:  Timestamp        (server-stamped on first write)
  │    ├─ endedAt:    Timestamp | null (server-stamped when status terminal)
  │    │
  │    └─ commits/{sha}
  │         ├─ sha:         string
  │         ├─ message:     string
  │         ├─ author:      string
  │         ├─ url:         string | null
  │         ├─ committedAt: Timestamp | null  (git commit time, agent-supplied)
  │         ├─ createdAt:   Timestamp         (server-stamped at write time)

users/{uid}
  ├─ email:     string
  ├─ isAllowed: boolean    (gates read access; managed out-of-band by an admin)
```

### Status enum

```
queued | running | blocked | paused | completed | failed | cancelled
```

Applies to both projects and phases. **The server does not police transitions**
— it records whatever valid status the agent reports. Terminal statuses are
`completed | failed | cancelled`.

### Design object

```
design: {
  format:    "markdown" | "url",
  content:   string,        // inline markdown, or a URL
  updatedAt: Timestamp      // server-stamped
}
```

Per-project. `content` is capped (see Validation) to stay well under Firestore's
1 MiB document limit.

### Identity & idempotency

- **`{slug}`**, **`{phaseId}`**, **`{sha}`** are all client-supplied document
  IDs. First write creates; later writes merge-upsert. All writes are therefore
  idempotent, and retries are no-ops with respect to identity.
- The agent must write in hierarchy order: project → phase → commit. Writing to
  a missing parent returns `404` (no implicit stub creation). The agent-side
  skill is responsible for upserting the project before its phases, and a phase
  before its commits.

### Required-on-create vs. optional-on-update

PUTs are merge-upserts, so the validator distinguishes the **creating** write
(target doc does not yet exist) from an **updating** write:

- **Project — required on create:** `title`, `status`. `design` is optional
  (nullable) and may be added/updated by a later write.
- **Phase — required on create:** `name`, `order`, `status`.
- **Commit — always required:** `message`, `author` (the `sha` is the doc ID).
  `url` and `committedAt` are optional.

On an updating write, any subset of the agent-supplied fields may be sent;
omitted fields are left unchanged. A creating write missing a required field is
rejected with `400`.

## API surface (write-only)

All endpoints are under `/v1` and require the write API key. All are idempotent
merge-upserts.

| Method & path | Purpose |
|---|---|
| `PUT /v1/projects/{slug}` | Upsert project (title, status, design). Merges supplied fields; omitted fields are left unchanged. |
| `PUT /v1/projects/{slug}/phases/{phaseId}` | Upsert a phase (name, order, status). Creates on first write, updates thereafter. |
| `PUT /v1/projects/{slug}/phases/{phaseId}/commits/{sha}` | Record a commit. |

Client requests never set server-owned fields (`currentPhaseId`, `createdAt`,
`updatedAt`, `startedAt`, `endedAt`); the server ignores them if present.

### Server-owned side effects

- **Every write:** stamp `updatedAt`, and stamp `createdAt`/`startedAt` **only
  on first write** of a doc (never overwritten on later upserts).
- **Phase upsert — `endedAt`:** if the phase's status is terminal and `endedAt`
  is not already set, stamp it. Already-set `endedAt` is never overwritten, so
  retrying a terminal-phase write is a true no-op.
- **Phase upsert — `currentPhaseId` (derived, not event-driven):** after the
  phase write, the server **recomputes** the project's `currentPhaseId` by
  reading the sibling phases: it is the non-terminal phase with the **lowest
  `order`**, or `null` if every phase is terminal. This is deterministic
  regardless of write order, survives retries and interleaving, and advances to
  the next phase automatically when the current one ends. (Phase counts are
  small, so the sibling read is cheap; the recompute and the phase write happen
  in a single transaction.)

  This means `currentPhaseId` reflects true phase state rather than the last
  event received. If the loop ever legitimately has two non-terminal phases at
  once, the lowest-`order` one is reported as current.

## Auth & security

### Writes (REST API)

- API key supplied in `Authorization: Bearer <key>` (canonical) or `x-api-key`
  (fallback). If both are present, `Authorization` wins.
- Validated by middleware using a **constant-time comparison**. The function
  accepts a **set** of valid keys (env/secret config) to allow zero-downtime
  rotation. Missing or unknown key → `401`.
- Keys stored as Cloud Functions secrets.

### Reads (website)

- Reads go through the Firebase client SDK with **Firebase Authentication
  (Google sign-in)**.
- Firestore security rules gate reads on an allowlist:

  ```
  allow read: if request.auth != null
              && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.isAllowed == true;
  allow write: if false;   // only the Admin SDK (REST API) writes
  ```

- A signed-in user with **no** `users/{uid}` doc (the default for a brand-new
  Google sign-in before an admin provisions them) is **denied**: the `get()`
  resolves to null and the `isAllowed == true` check fails closed.
- Because all reads require an allowlisted, authenticated user, the data
  (including inline designs and commit messages) is **not** publicly exposed.
- **Cost note:** the allowlist `get()` runs per document read. With real-time
  listeners over the `projects/**` tree this is a billed lookup per document;
  acceptable at this scale, but flagged so it's a conscious choice. (A future
  optimization is mirroring `isAllowed` into a custom auth claim to avoid the
  per-doc `get()`.)
- **`users` doc lifecycle is out of scope here.** This API exposes no `users`
  endpoint, and rules forbid client writes. User docs are created/managed by
  the admin UI via the Admin SDK (or a future auth-creation trigger) — defined
  in the UI/admin spec, not this one. Managing `isAllowed` (granting/revoking)
  lives there too.

## Validation & errors

- Validate request bodies with **Zod**. Reject invalid status enum values and
  malformed bodies with `400` and a clear message.
- Cap `design.content` length (e.g. 100 KB) to stay under Firestore's per-doc
  limit; reject oversized payloads with `400`.
- Slugs validated against `^[a-z0-9._-]+$` (no slashes — each ID is a single
  URL path segment); `phaseId` and `sha` use the same pattern.
- Consistent error envelope: `{ error: { code, message } }`.
  - `400` validation, `401` auth, `404` missing parent (project/phase),
    `500` unexpected.

## Testing

- **TDD throughout** (red-green-refactor).
- Unit-test validation (including required-on-create vs. optional-on-update),
  constant-time key check, and the side-effect logic against the **Firestore
  emulator**: `currentPhaseId` recompute (advances to next non-terminal phase
  by `order`; `null` when all terminal; lowest-`order` wins with two
  non-terminal), `endedAt` stamped once and never overwritten on retry, and
  `createdAt`/`startedAt`/`updatedAt` stamping.
- Integration tests hit the emulated functions end-to-end:
  upsert project → upsert phase → record commit → assert Firestore state,
  including the `404`-on-missing-parent and idempotent-retry cases.
- Test the Firestore security rules with the emulator: allowlisted user can
  read, non-allowlisted/anonymous cannot, and no client can write.

## Out of scope

- The website / UI, including admin management of the `isAllowed` allowlist
  (separate spec).
- The agent-side skill that calls this API (separate spec).
- Read endpoints (reads go through Firestore listeners).
- Per-project / multi-tenant write tokens (single rotating set of write keys
  for now).
- Rate limiting and write quotas (noted as a future hardening step).
