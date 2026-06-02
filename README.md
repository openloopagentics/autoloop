# Daloop

A status dashboard for software projects built in a loop by AI agents. Each
project has a design, a sequence of phases, and the commits made during those
phases. AI agents (Claude Code, Codex) report status as the loop runs by calling
a **write-only REST API**; the website displays status live via Firestore
real-time listeners.

This repository currently contains the **REST API** (Firebase Cloud Functions +
Firestore) and the Firestore **security rules**. The website/UI is a separate
concern.

Design and plan docs live under `docs/superpowers/`.

## Architecture

```
AI agents ──API key──▶ Cloud Functions REST API (write-only) ──Admin SDK──▶ Firestore
                                                                                 ▲
website ──Firebase Auth (Google) + isAllowed allowlist, read-only via rules─────┘
```

- The API only **writes**. All reads happen through Firestore real-time
  listeners from the website.
- Every write is an idempotent `PUT` upsert keyed by a client-supplied ID
  (`slug`, `phaseId`, `sha`).
- The server owns all derived state: `currentPhaseId` (recomputed as the
  lowest-`order` non-terminal phase) and all timestamps.

## Prerequisites

- **Node 22+** and npm
- **firebase-tools** (`npm i -g firebase-tools`)
- **Java** (required to run the Firestore emulator used by the tests)

## Setup

```bash
cd functions
npm install
```

## Testing

The test suites run against the Firestore emulator.

```bash
cd functions
npm test            # full API suite — self-launches the emulator (needs Java)
npm run test:rules  # firestore.rules suite — also self-launches the emulator
```

For a fast watch loop, run the emulator in one terminal and a filtered test run
in another:

```bash
npm run emulators                 # terminal 1
npm run test:watch                # terminal 2 (or: npm run test:run -- <filter>)
```

`npm run build` type-checks and compiles `src/` to `lib/`.

## API surface

All endpoints are under `/v1`, require the write API key, and are idempotent
merge-upserts.

| Method & path | Purpose |
|---|---|
| `PUT /v1/projects/{slug}` | Upsert a project (`title`, `status`, `design`). `title` and `status` required on create. |
| `PUT /v1/projects/{slug}/phases/{phaseId}` | Upsert a phase (`name`, `order`, `status`). All required on create. |
| `PUT /v1/projects/{slug}/phases/{phaseId}/commits/{sha}` | Record a commit (`message`, `author` always required; `url`, `committedAt` optional). |

`status` is one of: `queued | running | blocked | paused | completed | failed | cancelled`.
IDs (`slug`, `phaseId`, `sha`) must match `^[a-z0-9._-]+$` (single path segment,
no slashes).

The server stamps `createdAt`/`startedAt` once, `updatedAt` on every write, and
`endedAt` on the first terminal transition. Writing to a missing parent returns
`404`.

## Authentication

Writes require an API key in the request header (`Authorization: Bearer <key>`
is canonical; `x-api-key` is a fallback). Multiple keys are supported for
zero-downtime rotation.

- **Local:** set `DALOOP_WRITE_KEYS` (comma-separated) in `functions/.env`
  (see `functions/.env.example`).
- **Production:** store it as a Functions secret:

  ```bash
  firebase functions:secrets:set DALOOP_WRITE_KEYS
  ```

Reads are gated by Firestore security rules: a user must be authenticated
(Google sign-in) and have a `users/{uid}` document with `isAllowed: true`.
Provisioning user docs / the allowlist is handled by the admin UI (out of scope
for this repo).

## Deploy

```bash
firebase deploy --only functions,firestore:rules
```
