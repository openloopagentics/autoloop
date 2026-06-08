# Autoloop iOS — SP3b Account & Admin (Teams / Keys / Admin) — Design

**Date:** 2026-06-07
**Status:** Approved (design phase — autonomous; spec-reviewer + code-reviewer as quality gates)

## Context

SP1/SP2/SP3a are built (PR #67). The app shell (SP1) has three placeholder tabs —
**Teams**, **Keys**, **Admin** (Admin only when `isAdmin`). SP3b fills them in,
completing the iOS write surfaces. Mirrors `web/src/teams/*`, `web/src/keys/*`,
`web/src/admin/*`. No backend change.

### Two data patterns (from the web)
- **Teams** uses the **Firestore client SDK directly** — reads via listeners
  (`useTeamMembers`, `useTeamInvites`, `useMyPendingInvites`) and writes via
  `setDoc/addDoc/deleteDoc/updateDoc/writeBatch` + `serverTimestamp()`
  (`teams/actions.ts`). Gated by `firestore.rules`.
- **Keys** and **Admin** use the **REST API** (`keys/client.ts`,
  `admin/client.ts`): GET lists + POST/PUT/DELETE mutations, manual refresh (no
  live listener).

## Scope
Teams (create, invites in/out, members), Keys (mint/list/revoke), Admin
(allowlist users + access requests). Out: FCM (SP4), Android (SP5).

## Data layer

### New models (`Data/Models.swift`, SP1 `init(id:data:)` pattern where Firestore-backed)
- `Role` enum `owner|admin|member` (raw String; tolerate unknown → keep raw).
- `Member { uid, role: Role, email? }` (Firestore).
- `Invite { id, teamId?, email, role: Role, status? }` (Firestore).
- REST-decoded (Codable, from JSON): `KeyMeta { id, label, prefix, createdAt? }`,
  `MintedKey { …KeyMeta, key }`, `AdminUser { uid, email?, isAllowed, isAdmin }`,
  `AccessRequest { uid, email?, note?, status }`.

### Teams: Firestore writers + listeners
- `TeamActions` (`Data/TeamActions.swift`), porting `teams/actions.ts` with the
  Firebase iOS SDK (`Firestore.firestore()`, `setData`, `addDocument`,
  `deleteDocument`, `updateData`, `writeBatch`, `FieldValue.serverTimestamp()`):
  `createTeam(teamId:name:)`, `inviteMember(teamId:email:role:)`,
  `revokeInvite(teamId:inviteId:)`, `acceptInvite(_:Invite)` (batch: set member +
  delete invite), `declineInvite(_:Invite)`, `changeRole(teamId:uid:role:)`,
  `removeMember(teamId:uid:)`. Current uid/email from `Auth.auth().currentUser`.
- Listeners (reuse SP2 `CollectionStore`/`QueryListener`): team `members`, team
  `invites`, and `myPendingInvites` (`collectionGroup("invites").whereField("email"
  == currentUser.email.lowercased())`, teamId from `parent.parent`).

### Keys / Admin: REST GET + mutate
Extend `RestClient` with a generic typed GET (`get<T: Decodable>(path:) -> T`)
using `authHeader()` + the same `{error:{message}}` decode, returning a decoded
`Decodable`. Add methods mirroring the web clients:
- Keys: `listKeys() -> [KeyMeta]` (GET `/v1/keys`, unwrap `{keys}`),
  `mintKey(label:) -> MintedKey` (POST `/v1/keys`), `revokeKey(id:)` (DELETE).
- Admin: `listUsers() -> [AdminUser]` (GET `/v1/admin/users`, unwrap `{users}`),
  `setAllowed(uid:isAllowed:email?:)` (PUT `/v1/admin/users/{uid}`),
  `listAccessRequests() -> [AccessRequest]` (GET, unwrap `{requests}`),
  `decideAccessRequest(uid:decision:)` (POST `/v1/admin/access-requests/{uid}`).

### Pure logic (TDD)
Port `teams/teamId.ts`: `slugify(name)` (lowercase, non-`[a-z0-9._-]`→`-`, trim
leading/trailing `-`/`.`, fallback `"team"`) and `teamIdFromName(name, suffix:)`
(`"\(slugify(name))-\(suffix())"`; suffix injectable for tests, random 4-char
base36 in the app).

## UI (replace the SP1 placeholders)

### TeamsView (mirror `TeamsPage.tsx`)
A `TeamsStore` (`@MainActor`) owning: `myTeams` (reuse the members
collection-group → `[TeamRef]` already in `DashboardStore`; extract a shared
`MyTeamsStore` or duplicate the small listener), `myPendingInvites`, and per-team
`members`/`invites` listeners. Sections:
- **Create a team:** name field → `TeamActions.createTeam(teamIdFromName(name),
  name)`.
- **Pending invites for you:** each with Accept / Decline.
- **Your teams:** per-team card — name + copyable team id; member rows following
  the exact `MemberRow.tsx` rules:
  - `canManage = !isSelf && (viewerRole == "owner" || (viewerRole == "admin" &&
    member.role == "member"))` — owners manage anyone but themselves; admins manage
    only `member`-role rows (not other admins/owners).
  - When `canManage`: a role picker (options = owner sees `owner|admin|member`,
    admin sees only `member`) → `changeRole`, plus a Remove button → `removeMember`.
  - Otherwise: a plain role label.
  - When `isSelf`: always show a "Leave" button (`removeMember(self.uid)`),
    independent of `canManage`.
  - The invite form + sent-invites-with-revoke show only to managers
    (`owner|admin`, matching `TeamsPage` `isManager`).
Errors surface inline via `ErrorNote` (a shared "run action, capture error"
helper mirrors `useActionError`).

### KeysView (mirror `KeysPage.tsx`)
A `KeysStore` with REST `listKeys` on appear + manual `refresh()`. Mint form
(label) → on success show the **secret once** in a reveal panel (copyable,
dismissable — `NewKeyReveal`), then refresh. Key list with revoke (confirm).

### AdminView (mirror `AdminPage.tsx`, shown only when `auth.isAdmin`)
An `AdminStore` with REST `listUsers` + `listAccessRequests` on appear + refresh.
Sections: grant-by-uid form (`setAllowed(uid, true, email?)`); access requests
(approve/deny → `decideAccessRequest`); all users (toggle `isAllowed`). Each
mutation refreshes.

## Error handling
Firestore-action and REST errors surface inline (`ErrorNote`/alert); no optimistic
state for Teams (listeners reconcile). Keys/Admin re-fetch after each mutation
(manual refresh, mirroring the web). A failed mint/revoke/decide shows the message
and leaves the list as-is.

## Testing
- **Unit (XCTest):** `slugify`/`teamIdFromName` (injected suffix); model decoders
  for `Member`/`Invite` (Firestore dict) and `KeyMeta`/`MintedKey`/`AdminUser`/
  `AccessRequest` (JSON `Decodable`); REST list-unwrap (`{keys}`/`{users}`/
  `{requests}`).
- **Build + manual acceptance** (needs secrets): create a team; invite/accept/
  decline; change role/remove member; mint a key (see it revealed once) + revoke;
  as admin, grant by uid, approve/deny a request, toggle a user. Verify the Admin
  tab is hidden for non-admins.

## Notes
- Role naming: the web is internally inconsistent — `DashboardHome.tsx` gates
  delete on `owner|manager` (mirrored in SP3a) while `teams/*` uses `owner|admin|
  member`. SP3b mirrors `teams/*` (`owner|admin`) for team management; this is a
  pre-existing web quirk, not reconciled here.

## Out of scope (later)
FCM push (SP4); Android (SP5).
