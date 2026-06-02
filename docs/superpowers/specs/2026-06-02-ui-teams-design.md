# Daloop UI — Team & Membership Management (UI-C) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase; decisions delegated to the implementer)

## Context

UI-A (shell+auth) and UI-B (dashboard) are merged. UI-C adds the `/teams` page:
create teams, manage members/roles, send + accept email invites — all **client-side
Firestore writes governed by the Sub-project A security rules** (no API calls).

Recap of the relevant rules (already deployed):
- **Team create** = an `isAllowed` user creates `teams/{teamId}` with
  `createdBy == their uid`, **then** (separate write) creates
  `teams/{teamId}/members/{uid}` with `role: "owner"` (sequential bootstrap).
- **Members:** read if member; `update` by a manager (owner/admin), not self,
  immutable `uid/joinedAt/email/inviteId`, and only an **owner** may set
  `owner`/`admin` (an admin may only keep a target at `member`); `delete` by a
  manager or by the user themselves (leave).
- **Invites:** `create` by a manager (`status:"pending"`, `invitedBy==uid`, email
  stored lowercased); `read` by a manager or the invitee (verified email,
  case-insensitive); `delete` by a manager or the invitee. **Accept** = an atomic
  client batch: create `members/{uid}` carrying `inviteId` (the rule verifies the
  matching pending invite) + delete the invite.

## Key decisions

- **Team id must match `^[a-z0-9._-]+$`** (so agents can later report to it via the
  API, which validates `teamId` against that pattern). A pure
  `teamIdFromName(name)` slugifies to lowercase + a short lowercase-random suffix
  (e.g. `acme-web` → `acme-web-k3f9`). Unit-tested. (Do NOT use Firestore auto-ids —
  they contain uppercase and would 400 at the agent write path.)
- **Invitee discovery:** a signed-in user finds invites addressed to them via a
  **`collectionGroup("invites").where("email","==", myEmail.toLowerCase())`** live
  query — the rules permit the invitee to read those. This needs a new
  `collectionGroup` index on `invites.email` (add to `firestore.indexes.json` and
  deploy). The teamId is `snap.ref.parent.parent.id`.
- **Accept** uses a Firestore `writeBatch`: set `members/{uid}` with
  `{uid, role: invite.role, email, inviteId}` + delete the invite (both evaluate
  against pre-batch state, matching the rules).

## Architecture (UI-A/B pattern)

- **Pure, tested:** `teamIdFromName(name)` (slug + random suffix; validate against
  the id pattern).
- **Presentational components (props-only, tested):** `TeamCreateForm`
  ({onCreate}), `MemberRow` ({member, viewerRole, selfUid, onChangeRole, onRemove}
  — renders role controls only when allowed), `InviteForm` ({onInvite}),
  `InviteRow` ({invite, onRevoke}), `PendingInviteRow` ({invite, onAccept,
  onDecline}), and small panels that lay out lists from props.
- **Firebase glue (build-only, not unit-tested):** `teams/hooks.ts`
  (`useTeamMembers(teamId)`, `useTeamInvites(teamId)`, `useMyPendingInvites()` —
  live) and `teams/actions.ts` (`createTeam`, `inviteMember`, `revokeInvite`,
  `acceptInvite`, `declineInvite`, `changeRole`, `removeMember` — the write
  functions, each a thin wrapper over the SDK encoding the rule-shaped payloads).
  Reuse `useMyTeams` from `dashboard/hooks.ts`.
- **Page/containers (thin glue):** `TeamsPage` lists my teams (via `useMyTeams`) +
  the create form + a "Pending invites for you" panel (via `useMyPendingInvites`);
  per team, a keyed `TeamAdminContainer` (one `useTeamMembers` + one
  `useTeamInvites`) renders the members panel + (for managers) the invite form &
  list. One hook-set per keyed child → no rules-of-hooks violation.

## Behavior

- **Create team:** form → `teamIdFromName(name)` → `createTeam(id, name, uid)` does
  the two sequential writes (team doc, then own owner member). Surface a clear error
  if the write is denied (e.g. not `isAllowed`).
- **Roles:** `MemberRow` shows a role `<select>` + Remove only when the viewer is a
  manager and the row isn't the viewer; an admin's select offers only `member` (per
  the rules), an owner's offers all three. "Leave" appears on the viewer's own row.
- **Invites:** manager-only `InviteForm` (email + role) → `inviteMember` (stores
  lowercased email, `status:"pending"`, `invitedBy`). `InviteRow` revoke → delete.
- **Pending invites for me:** `PendingInviteRow` accept → `acceptInvite` (batch);
  decline → `declineInvite` (delete). On accept, the team appears in my teams (the
  `useMyTeams` listener updates live).
- All write failures (permission-denied, etc.) are caught and shown inline; never a
  crash.

## Routing

`/teams` (replacing the `ComingSoon` placeholder) → `TeamsPage`. The AppShell
"Teams" nav link already points there.

## firestore.indexes.json

Add a `collectionGroup` single-field index on `invites.email` (alongside the
existing `members.uid`). Deploy with `firebase deploy --only firestore:indexes`.

## Testing

Vitest + jsdom + RTL. Unit-test the pure `teamIdFromName` (slug, lowercasing,
pattern compliance, suffix uniqueness) and the presentational components with
fixtures + injected callbacks: `TeamCreateForm` calls `onCreate` with the typed
name; `MemberRow` shows/hides role + remove + leave per `viewerRole`/`selfUid` and
emits `onChangeRole`/`onRemove`; admin select offers only `member`; `InviteForm`
calls `onInvite` with email+role; `InviteRow`/`PendingInviteRow` emit
revoke/accept/decline. Hooks, actions, page, and containers are Firebase glue
(build-only). App.test stays firebase-free (the Teams route is lazy/under the shell;
if `TeamsPage` is statically imported into `App.tsx`, mock `teams/hooks` +
`dashboard/hooks` in `App.test.tsx` exactly as UI-B did).

## Out of scope

- Inviting by uid, team deletion, transferring ownership, last-owner protection
  (rules already defer last-owner).
- The API-key UI (UI-D) and admin allowlist (UI-E).
- Backend/rules changes (the rules already support all of this); only a new
  Firestore index is added.
