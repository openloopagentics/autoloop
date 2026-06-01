# Daloop REST API — Design

**Date:** 2026-06-01
**Status:** Approved (design phase)

## Context

Daloop is a frontend that displays the status of many projects being developed
in a loop by AI agents. Each project has a design, a set of phases, and the
commits made during those phases. This spec covers **the REST API only** — the
write surface that AI agents (Claude Code, Codex) call, via a skill, to report
status as the loop executes.

Reads are out of scope for the REST API: the public website subscribes to
Firestore directly with real-time listeners. The website itself (UI) is a
separate concern with its own spec.

## Architecture

```
AI agents (Claude/Codex via a skill)
   │  API key (write)  — POST/PATCH/PUT granular events
   ▼
Cloud Functions REST API (write-only)
   │  validation + denormalization bookkeeping
   │  Firebase Admin SDK
   ▼
Firestore  (projects / phases / commits)
   ▲
   │  real-time listeners (public, read-only via security rules)
Public website (separate app, Firebase client SDK)
```

Key decisions:

- **Runtime:** Firebase Cloud Functions, Express-style, using the Firebase
  Admin SDK to write Firestore.
- **Write-only API.** All reads happen through Firestore real-time listeners
  from the website. The API exposes no read endpoints.
- **Granular event endpoints.** Agents fire small events as things happen
  (start phase, update phase, record commit) rather than syncing full state.
  This maps cleanly to the loop's lifecycle and avoids clobbering.
- **Agent stays dumb.** The API owns denormalized bookkeeping
  (`currentPhaseId`, `updatedAt`) so agents only report the event that occurred.

## Data model (Firestore)

Nested collections mirror the hierarchy `project → phases → commits`:

```
projects/{slug}
  ├─ slug:            string   (client-supplied ID, e.g. "acme/web")
  ├─ title:           string
  ├─ status:          Status
  ├─ design:          Design
  ├─ currentPhaseId:  string | null   (denormalized for quick UI display)
  ├─ createdAt:       Timestamp
  ├─ updatedAt:       Timestamp
  │
  ├─ phases/{phaseId}
  │    ├─ name:       string
  │    ├─ order:      number
  │    ├─ status:     Status
  │    ├─ startedAt:  Timestamp
  │    ├─ endedAt:    Timestamp | null
  │    │
  │    └─ commits/{sha}
  │         ├─ sha:       string
  │         ├─ message:   string
  │         ├─ author:    string
  │         ├─ url:       string | null
  │         ├─ createdAt: Timestamp
```

### Status enum

```
queued | running | blocked | paused | completed | failed | cancelled
```

Applies to both projects and phases.

### Design object

```
design: {
  format:    "markdown" | "url",
  content:   string,        // inline markdown, or a URL
  updatedAt: Timestamp
}
```

Per-project (not per-phase). Lets the agent either inline a design doc or link
to one.

### Identity & idempotency

- **`{slug}`** is the client-supplied project ID. First write creates the
  project; later writes update it (idempotent upsert). No separate registration
  step — the loop just starts reporting.
- **`{sha}`** is the commit document ID, giving free idempotency: re-recording
  the same commit is a no-op.
- **Phase creation** is made idempotent via a client-supplied `phaseKey`, so
  agent retries do not create duplicate phases.

## API surface (write-only)

All endpoints are under `/v1` and require the write API key.

| Method & path | Purpose |
|---|---|
| `PUT /v1/projects/{slug}` | Upsert project (title, status, design). Creates on first call. |
| `PATCH /v1/projects/{slug}` | Partial update (e.g. just `status` or `currentPhaseId`). |
| `POST /v1/projects/{slug}/phases` | Start/declare a phase. Returns `phaseId`. Idempotent on `phaseKey`. |
| `PATCH /v1/projects/{slug}/phases/{phaseId}` | Update phase status / `endedAt`. |
| `PUT /v1/projects/{slug}/phases/{phaseId}/commits/{sha}` | Record a commit (idempotent — `sha` is doc ID). |

### Server-owned side effects

- On phase create/patch: update the project's `currentPhaseId` and `updatedAt`.
- On any write: bump the relevant `updatedAt`.

## Auth & security

- **Writes:** API key supplied in `Authorization: Bearer <key>` (or `x-api-key`)
  header, validated by middleware in the function. Key stored as a Cloud
  Functions secret / env config. Missing or wrong key → `401`.
- **Reads:** Firestore security rules — `allow read: if true;` on the
  `projects/**` tree and `allow write: if false;`. Only the Admin SDK (which
  bypasses rules) can write. The public can therefore only read, even though
  the collection is world-readable.

## Validation & errors

- Validate request bodies with **Zod**. Reject invalid status enum values and
  malformed bodies with `400` and a clear message.
- Consistent error envelope: `{ error: { code, message } }`.
  - `400` validation, `401` auth, `404` unknown project/phase, `500` unexpected.
- Slugs validated against `^[a-z0-9._/-]+$` to keep them URL- and
  Firestore-safe.

## Testing

- **TDD throughout** (red-green-refactor).
- Unit-test validation and the side-effect/denormalization logic
  (`currentPhaseId`, `updatedAt`) against the **Firestore emulator**.
- Integration tests hit the emulated functions end-to-end:
  upsert project → start phase → record commit → assert Firestore state.

## Out of scope

- The public website / UI (separate spec).
- The agent-side skill that calls this API (separate spec).
- Read endpoints (reads go through Firestore listeners).
- Multi-tenant / per-project tokens (using a single write API key for now).
