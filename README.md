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

All endpoints are under `/v1`. There are two groups with different auth (see
**Authentication**): **key management** (a logged-in human, Firebase ID token)
and **agent writes** (a per-user API key).

**Key management** — `Authorization: Bearer <Firebase ID token>`:

| Method & path | Purpose |
|---|---|
| `POST /v1/keys` | Mint a key. Body `{ label }`. Returns `{ id, key, label, prefix, createdAt }` — the plaintext `key` is shown **once**. |
| `GET /v1/keys` | List the caller's keys (`id`, `label`, `prefix`, `createdAt` — never the plaintext). |
| `DELETE /v1/keys/{id}` | Revoke one of the caller's keys (`id` is the keyHash). |

**Agent writes** — `Authorization: Bearer <API key>`; idempotent merge-upserts:

| Method & path | Purpose |
|---|---|
| `PUT /v1/teams/{teamId}/projects/{slug}` | Upsert a project (`title`, `status`, `design`; `title`+`status` required on create). |
| `PUT /v1/teams/{teamId}/projects/{slug}/phases/{phaseId}` | Upsert a phase (`name`, `order`, `status`; all required on create). |
| `PUT /v1/teams/{teamId}/projects/{slug}/phases/{phaseId}/commits/{sha}` | Record a commit (`message`, `author` always required; `url`, `committedAt` optional). |

`status` is one of: `queued | running | blocked | paused | completed | failed | cancelled`.
IDs (`slug`, `phaseId`, `sha`) must match `^[a-z0-9._-]+$` (single path segment,
no slashes).

The server stamps `createdAt`/`startedAt` once, `updatedAt` on every write, and
`endedAt` on the first terminal transition. An unknown/revoked key → `401`; a
valid key whose user isn't a member of the target team → `403`; a missing
project/phase parent (for a member) → `404`.

## Authentication

- **Key management (`/v1/keys`)** is authenticated by a **Firebase ID token**
  (the website obtains it after Google sign-in) and requires the user to be
  `isAllowed`. Minting returns the plaintext key once; only its SHA-256 hash is
  stored (`apiKeys/{hash}`).
- **Agent writes** are authenticated by a **per-user API key** in
  `Authorization: Bearer dl_…` (or the `x-api-key` header). The server hashes the
  key, resolves it to its owner, and authorizes the write against the target
  team's membership.

No shared/server-wide write key exists; there is nothing to configure in
`functions/.env` to run the API (see `functions/.env.example`). Agents get a key
by having an allowlisted user mint one via `POST /v1/keys`.

## Teams & access

Projects are owned by **teams**. Each user belongs to teams with a role
(`owner` / `admin` / `member`); all roles can write project status, and reads
are scoped to team membership. Team, membership, and invite management is done
by the UI writing Firestore directly, governed by `firestore.rules`:

- Any signed-in, `isAllowed` user can create a team (becoming its owner).
- New members join via an email invite + accept flow.
- Owners manage roles; admins manage plain members; admins cannot demote/promote
  owners or other admins.
- Reads of a team's projects/phases/commits require membership; all client
  writes to project data are denied (only the API's Admin SDK writes it).

`isAllowed` (on `users/{uid}`) is the global "allowed into Daloop at all" gate,
checked at the entry points (creating a team, accepting an invite). Provisioning
user docs / the allowlist is handled by the admin UI (out of scope for this repo).

Agent writes are authorized per-user: a key resolves to its owner, who must be a
member of the team being written to (see **Authentication**).

## Deploy

```bash
firebase deploy --only functions,firestore:rules
```

The API no longer uses a shared write key. After deploying the per-user-key
change, decommission the old Functions secret:

```bash
firebase functions:secrets:destroy DALOOP_WRITE_KEYS
```
