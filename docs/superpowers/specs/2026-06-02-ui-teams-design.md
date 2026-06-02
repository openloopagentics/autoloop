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
  API, which validates `teamId`). Pure `teamIdFromName(name)` contract: lowercase;
  replace each run of `[^a-z0-9._-]` with `-`; trim leading/trailing `-`/`.`; if the
  result is empty (blank or all-non-ASCII name), fall back to base `"team"`; then
  append `-<suffix>` where `suffix ∈ [a-z0-9]{4}` (lowercase only — NOT a base36/
  uppercase id). So the id is always non-empty and matches the pattern. Unit-tested,
  including empty and pure-non-ASCII names. (Do NOT use Firestore auto-ids — they
  contain uppercase and would 400 at the agent write path.)
- **Invitee discovery:** a signed-in user finds invites addressed to them via a
  **`collectionGroup("invites").where("email","==", myEmail.toLowerCase())`** live
  query, with `teamId = snap.ref.parent.parent?.id`. This needs a new
  **collectionGroup-scoped** single-field index on `invites.email`. Rule note: the
  invite read rule is `isManager(teamId) || (email_verified && resource.data.email
  == request.auth.token.email.lower())`; for this collection-group query the query
  succeeds via the **invitee branch** (the `isManager` branch simply evaluates false
  for foreign invites and does not block the query), and it **requires the token's
  `email_verified` claim** — Google sign-in guarantees it. (Do a manual
  emulator/console check that it returns only the invitee's own invites before
  merge.)
- **Accept** uses a Firestore `writeBatch`: set `members/{uid}` with
  `{ uid, role: invite.role, email: invite.email /* already lowercased */,
  inviteId: invite.id, joinedAt: serverTimestamp() }` + delete the invite (both
  evaluate against pre-batch state). The member `email` is pinned to the
  lowercased invite email (not `auth.currentUser.email`) to avoid a casing
  mismatch. Precondition: a verified email (Google) — an unverified provider would
  get permission-denied.
- **`joinedAt` on member create:** both the bootstrap owner-member write
  (`createTeam`) and the accept-create set `joinedAt: serverTimestamp()` for a
  consistent member shape (the rules treat `joinedAt` as immutable on later
  updates).

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
- **Roles (rank-aware gating, matching the rules):** the role `<select>` and Remove
  appear only when the viewer **outranks** the target, not merely "is a manager":
  - `viewerRole === "owner"` → full select (owner/admin/member) + Remove on any
    non-self row.
  - `viewerRole === "admin"` → controls ONLY on rows whose current role is
    `member` (a `member`-only select + Remove); an admin sees **no** controls on
    `owner`/`admin` rows (the rules forbid an admin touching a manager).
  - `member` viewer → no controls.
  - "Leave" appears on the viewer's own row regardless of role.
  This keeps the UI aligned with the rules so users don't hit permission-denied for
  actions the UI appeared to offer.
- **Invites:** manager-only `InviteForm` (email + role) → `inviteMember` (stores
  lowercased email, `status:"pending"`, `invitedBy`). `InviteRow` revoke → delete.
- **Pending invites for me:** `PendingInviteRow` accept → `acceptInvite` (batch);
  decline → `declineInvite` (delete). On accept, the team appears in my teams (the
  `useMyTeams` listener updates live).
- All write failures (permission-denied, etc.) are caught and shown inline; never a
  crash.

## States (each live panel)

Each hook exposes `{ data, loading, error }`; panels render:
- **loading** → `Spinner` (reuse the dashboard component) while listeners attach.
- **read error** → `ErrorNote` (e.g. a missing index before deploy, or a denied
  read) — never a blank panel.
- **empty** → "You're not on a team yet" (my teams), "No pending invites" (pending),
  "No invites" (team invites). ("No members" shouldn't occur — the owner is always a
  member.)
- **Self-leave / last-owner:** clicking Leave deletes the viewer's own member doc;
  `useMyTeams` then drops the team and its `TeamAdminContainer` unmounts. A **sole
  owner** leaving is denied by the rules (last-owner deferred) → surface the
  permission-denied as an inline error, don't fail silently. During unmount the
  members listener may briefly get a denied/empty read (own member doc gone) — the
  container must tolerate that transient (treat as empty/none, no crash).

## Routing

`/teams` (replacing the `ComingSoon` placeholder) → `TeamsPage`. The AppShell
"Teams" nav link already points there.

## firestore.indexes.json

Add a `collectionGroup` single-field index on `invites.email` (alongside the
existing `members.uid`). Deploy with `firebase deploy --only firestore:indexes`.

## Testing

Vitest + jsdom + RTL. Unit-test the pure `teamIdFromName` (slug, lowercasing,
pattern compliance, **empty-name and pure-non-ASCII name → non-empty valid id**,
suffix is `[a-z0-9]`) and the presentational components with fixtures + injected
callbacks: `TeamCreateForm` calls `onCreate` with the typed name; **`MemberRow`
rank-aware gating** — owner viewer + non-self row → full select + Remove; admin
viewer + `member` row → member-only select + Remove; **admin viewer + owner row →
no controls; admin viewer + admin row → no controls**; member viewer → no controls;
viewer's own row → Leave; and it emits `onChangeRole`/`onRemove`; `InviteForm`
calls `onInvite` with email+role; `InviteRow`/`PendingInviteRow` emit
revoke/accept/decline.

Hooks, actions, page, and containers are Firebase glue (build-only). **App.test
firebase-free:** `App.tsx` statically imports `TeamsPage`, whose chain reaches
`teams/hooks.ts` AND `teams/actions.ts`, both of which import `firebase.ts` (whose
top-level `getAuth` throws on the blank test env). So `App.test.tsx` must hoist
`vi.mock` for **`./teams/hooks`, `./teams/actions`, AND `./dashboard/hooks`**
(mocking only the hooks is insufficient — `actions.ts` is the other firebase-
importing module reachable from `TeamsPage`). Follow the UI-B `vi.mock` pattern.

## Out of scope

- Inviting by uid, team deletion, transferring ownership, last-owner protection
  (rules already defer last-owner).
- The API-key UI (UI-D) and admin allowlist (UI-E).
- Backend/rules changes (the rules already support all of this); only a new
  Firestore index is added.
