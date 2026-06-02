# Daloop Multi-Tenant Foundation (Sub-project A) — Design

**Date:** 2026-06-01
**Status:** Approved (design phase)

## Context

Daloop is evolving from single-tenant to **multi-tenant**. The end state:
teams own projects; users belong to teams with roles; users mint user-scoped API
keys; agent writes are authorized by team membership. This is too large for one
spec, so it is split into two sequenced sub-projects:

- **Sub-project A — Multi-tenant foundation (this spec):** the team/membership/
  invite data model, the Firestore security rules that govern human-side
  management and membership-scoped reads, project ownership by team, and
  repointing the agent write endpoints under the team path. Agent write auth
  remains the existing shared key as a temporary stopgap.
- **Sub-project B (separate spec, next):** per-user API key lifecycle
  (Firebase-ID-token-authenticated mint/list/revoke, hashed storage) and the
  rewrite of agent write auth from the shared key to
  `API key → user → team-membership` authorization.

The UI itself is out of scope (separate effort). This builds on the existing
single-tenant REST API (`docs/superpowers/specs/2026-06-01-rest-api-design.md`).

**Greenfield assumption:** there is no production data (PR #1 is not merged), so
"migration" means restructuring the model and code — no data backfill.

## Model summary (decisions locked during brainstorming)

- **Teams own projects.** Roles: `owner | admin | member`; all roles can write
  project status.
- **API keys are user-scoped** (relevant to B): a key acts as its user; each
  write checks the user's membership in the target project's team.
- **Management split:** humans manage teams, memberships, and invites by writing
  Firestore directly from the UI, governed by security rules. Key minting (B)
  is a server endpoint. Agents write project status through the API.
- **New members join via an email invite + accept flow.**
- **`isAllowed`** (on `users/{uid}`) remains the global "allowed into Daloop at
  all" gate, checked at the entry points (create team, accept invite). Day-to-day
  team reads check membership only.

## Data model (Firestore)

```
teams/{teamId}
  ├─ name:       string
  ├─ createdBy:  string (uid)
  ├─ createdAt:  Timestamp
  ├─ updatedAt:  Timestamp
  │
  ├─ members/{uid}
  │    ├─ uid:      string   (duplicated so a collectionGroup query can filter by it)
  │    ├─ role:     "owner" | "admin" | "member"
  │    ├─ email:    string   (denormalized for display)
  │    ├─ joinedAt: Timestamp
  │
  ├─ invites/{inviteId}
  │    ├─ email:     string  (lowercased)
  │    ├─ role:      "owner" | "admin" | "member"   (granted on accept)
  │    ├─ invitedBy: string  (uid)
  │    ├─ status:    "pending"
  │    ├─ createdAt: Timestamp
  │
  └─ projects/{slug}
       ├─ slug, title, status, design, currentPhaseId, createdAt, updatedAt
       └─ phases/{phaseId}
            ├─ name, order, status, startedAt, endedAt
            └─ commits/{sha}
                 ├─ sha, message, author, url, committedAt, createdAt

users/{uid}
  ├─ email:     string
  ├─ isAllowed: boolean   (global access gate; managed out-of-band by an admin)
```

Notes:

- **Project slugs are unique per team** (the team is in the path), not globally.
- A **`collectionGroup('members')` index on `uid`** powers the "which teams am I
  in?" reverse lookup.
- Project / phase / commit document shapes are unchanged from the single-tenant
  spec — only their location (under `teams/{teamId}`) changes.

## Security rules

Team/member/invite management is performed by the UI via the Firebase client SDK,
governed by these rules. The `projects/**` subtree remains client-read /
client-write-denied (only the Admin SDK, used by the API, writes it).

### Access matrix (client SDK)

| Path | read | create | update | delete |
|---|---|---|---|---|
| `teams/{teamId}` | team members | any `isAllowed` signed-in user (becomes owner) | owner/admin | owner |
| `teams/{teamId}/members/{uid}` | own member doc (any team) **or** team members | bootstrap-owner **or** invite-accept (self) | owner/admin | owner/admin, or self (leave) |
| `teams/{teamId}/invites/{id}` | owner/admin **or** the invitee (by verified email) | owner/admin | invitee (accept) | owner/admin or invitee |
| `teams/{teamId}/projects/**` | team members | ❌ (API/Admin SDK only) | ❌ | ❌ |
| `users/{uid}` | own doc | ❌ | ❌ | ❌ |

### Helper predicates (rules functions)

- `isSignedIn()` → `request.auth != null`.
- `isAllowedUser()` → signed in AND `get(users/{uid}).data.isAllowed == true`.
  Used only at entry points (team create, invite accept).
- `isMember(teamId)` → `exists(teams/{teamId}/members/{request.auth.uid})`.
- `memberRole(teamId)` → `get(teams/{teamId}/members/{request.auth.uid}).data.role`.
- `isManager(teamId)` → member role is `owner` or `admin`.

### Three rules that need care

1. **Team bootstrap.** Creating a team and the creator's own `owner` member doc
   are two writes issued as a client batch. The `members/{uid}` create rule
   allows it when `uid == request.auth.uid`, `role == "owner"`, and
   `request.auth.uid == get(teams/{teamId}).data.createdBy`. The team-create
   rule requires `isAllowedUser()` and `request.resource.data.createdBy ==
   request.auth.uid`.
2. **Invite accept.** The invitee is matched by `request.auth.token.email ==
   resource/invite email` with `request.auth.token.email_verified == true` and
   `isAllowedUser()`. Accept is a client batch: create `members/{uid}` (rule
   verifies a matching pending invite exists and the new member's `role` equals
   the invite's `role`) and delete/mark the invite (rule allows the invitee to
   delete/update an invite whose email matches their verified email). The two
   writes are evaluated independently; a brief non-atomic window is acceptable.
3. **Membership reverse-read.** A user may read their own `members/{uid}` doc in
   any team (`request.auth.uid == uid`) — required by the `collectionGroup`
   "my teams" query. Reading *other* members of a team requires `isMember`.

### `isAllowed` placement

`isAllowed` gates only the entry points — **creating a team** and **accepting an
invite** both require `isAllowedUser()`. Ongoing team data reads check
**membership only**, keeping the per-document `isAllowed` lookup off the hot read
path. Membership therefore implies the user was `isAllowed` at join time. (If
`isAllowed` is later revoked, existing memberships persist until an admin removes
them — acceptable.)

### Cross-team isolation

Every team-scoped read rule is anchored on `isMember(teamId)` for the team in the
path, so a member of team A cannot read team B's members, invites, or projects.

## Agent write API changes

The three write endpoints move under the team path; transaction logic is
otherwise unchanged:

```
PUT /v1/teams/{teamId}/projects/{slug}
PUT /v1/teams/{teamId}/projects/{slug}/phases/{phaseId}
PUT /v1/teams/{teamId}/projects/{slug}/phases/{phaseId}/commits/{sha}
```

- Services repoint document refs from `projects/{slug}` to
  `teams/{teamId}/projects/{slug}` (phases/commits nest beneath). All derived
  state (`currentPhaseId` recompute, `createdAt`/`startedAt`/`updatedAt`/
  `endedAt` stamping) carries over verbatim.
- New parent check: **`404` if the team does not exist**, in addition to the
  existing project/phase parent checks. `teamId` is validated against the
  existing `idPattern` (`^[a-z0-9._-]+$`).
- **Auth is a deliberate stopgap in A:** the endpoints keep the existing
  shared-key `requireWriteKey` middleware. During A, any valid shared key can
  write to any team — there is no per-team authorization yet. Sub-project B
  replaces this with `API key → user → team-membership` resolution.

Repointing the paths now (rather than deferring to B) keeps agent writes landing
in the correct, team-owned location; the alternative would leave the endpoints
writing to an orphaned top-level `projects/` collection.

## Validation & errors

- Unchanged error envelope `{ error: { code, message } }`. API returns `404` for
  missing team/project/phase, `400` for validation, `401` for a missing/invalid
  shared key (until B), `500` unexpected.
- Rule denials surface to the client SDK as `permission-denied`.

## Testing

### Rules tests (`@firebase/rules-unit-testing`)

- Team create requires `isAllowed`; non-`isAllowed` user denied.
- Bootstrap: creator can create their own `owner` member doc; cannot fabricate
  another user's member doc or self-assign owner without being `createdBy`.
- Invites: only owner/admin create; the invitee (matching verified email +
  `isAllowed`) can read and accept; a non-invitee cannot read or accept.
- Membership reverse-read: a user reads their own member docs across teams;
  cannot read others' member docs in a team they don't belong to.
- Cross-team isolation: a member of team A cannot read team B's projects,
  members, or invites.
- `projects/**`: members can read; all client writes are denied.

### API tests (Firestore emulator + Supertest)

- Repointed write endpoints: `404` on a missing team; successful writes land
  under `teams/{teamId}/projects/...`.
- All existing project/phase/commit behaviors still pass under the new paths
  (idempotency, required-on-create, derived `currentPhaseId`, `endedAt`-once,
  404 on missing parent).

## Out of scope (deferred to Sub-project B or later)

- Per-user API key lifecycle (mint/list/revoke, hashed storage) and the
  ID-token-authenticated endpoints that own it.
- Rewriting agent write auth from the shared key to membership-based
  authorization.
- The UI / admin console (separate effort), including how `isAllowed` is set on
  user records.
- Role changes that would remove the last owner (lockout prevention), team
  deletion cascades, and invite expiry — not required for the foundation.
