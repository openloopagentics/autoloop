# iOS Account & Admin (SP3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fill the Teams, Keys, and Admin tabs on iOS — team create/invite/membership management (direct Firestore), API-key mint/list/revoke and admin allowlist management (REST) — completing the iOS write surfaces.

**Architecture:** Teams = Firebase iOS SDK directly (listeners + `setData/addDocument/deleteDocument/updateData/writeBatch` + `FieldValue.serverTimestamp()`), mirroring `teams/actions.ts`+`hooks.ts`. Keys/Admin = REST via a new typed `RestClient.get`, manual refresh, mirroring `keys/client.ts`+`admin/client.ts`. Reuses SP1/SP2 (`RestClient`, `CollectionStore`/`QueryListener`, `ErrorNote`/`Spinner`/`EmptyState`).

**Tech Stack:** SwiftUI, iOS 16, Firebase, XCTest. Spec: `docs/superpowers/specs/2026-06-07-ios-account-admin-design.md`.

## Conventions (every task)
- Repo root `/Users/ravikantcherukuri/.superset/worktrees/736423e6-7c9f-44b2-9949-bbd8a83e9e82/native-mobile-apps`; iOS at `ios/`. Branch `native-mobile-apps`.
- After adding files: `cd ios && xcodegen generate`. Simulator **`iPhone 16e`**. Build/test `-destination 'platform=iOS Simulator,name=iPhone 16e'`. Build + XCTest only; keep suite green (currently 61). Commit per task; footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse: `RestClient` (`url(_:_:_:)`, `authHeader()`, `check(_:_:)`, `ApiError`, existing `send`), `CollectionStore`/`QueryListener`, `ErrorNote`/`Spinner`/`EmptyState`, Firestore decode accessors (`.str/.bool/...`), `AuthStore` (`isAdmin`, `user`). Models use `init(id:data:)` for Firestore, `Decodable` for REST JSON. `ProjectTask` not `Task`.
- The placeholder `TeamsView`/`KeysView`/`AdminView` exist (SP1, in `Features/Placeholders/`); replace their bodies (you may move/rename files under `Features/Teams`, `Features/Keys`, `Features/Admin` — update any references; they're only referenced from `AppShell.swift`).

---

## Task 1: Models + REST GET + pure logic (TDD)
**Files:** extend `Data/Models.swift`; extend `Data/RestClient.swift`; create `Features/Teams/TeamIdLogic.swift`; tests `AutoloopTests/{AccountModelsTests,TeamIdLogicTests}.swift`.

- [ ] **Step 1 (red):** tests:
```swift
// TeamIdLogicTests
func testSlugify() {
    XCTAssertEqual(slugifyTeam("My Team!"), "my-team")
    XCTAssertEqual(slugifyTeam("--..x.."), "x")
    XCTAssertEqual(slugifyTeam("!!!"), "team")   // fallback
}
func testTeamIdFromName() {
    XCTAssertEqual(teamIdFromName("My Team", suffix: { "ab12" }), "my-team-ab12")
}
// AccountModelsTests
func testMemberInviteDecode() {
    XCTAssertEqual(Member(id:"u1", data:["role":"admin","email":"a@x"]).role, .admin)
    XCTAssertEqual(Invite(id:"i1", teamId:"t", data:["email":"a@x","role":"member"]).email, "a@x")
}
func testRestModelsDecodeJSON() throws {
    let km = try JSONDecoder().decode(KeyMeta.self, from: Data(#"{"id":"k","label":"l","prefix":"al_"}"#.utf8))
    XCTAssertEqual(km.prefix, "al_")
    let au = try JSONDecoder().decode(AdminUser.self, from: Data(#"{"uid":"u","isAllowed":true,"isAdmin":false}"#.utf8))
    XCTAssertTrue(au.isAllowed)
}
```
Run → FAIL.
- [ ] **Step 2 (green):** implement:
  - `enum Role: String { case owner, admin, member }` with a lenient init from String (unknown → `.member`? — prefer storing the raw string; use `Role(rawValue:) ?? .member`). Add `Member { uid(id), role: Role, email? }` and `Invite { id, teamId?, email, role: Role, status? }` with `init(id:data:)` (Firestore) — `Invite` also `init(id:teamId:data:)`.
  - REST `Decodable` models: `KeyMeta { id, label, prefix, createdAt: Double? }` (createdAt may be absent/number), `MintedKey { id, label, prefix, key, createdAt: Double? }`, `AdminUser { uid, email: String?, isAllowed: Bool, isAdmin: Bool }`, `AccessRequest { uid, email: String?, note: String?, status: String }`.
  - `slugifyTeam(_:)` + `teamIdFromName(_:suffix:)` (default suffix = random 4-char base36) per `teamId.ts`.
  - `RestClient.get<T: Decodable>(path:) async throws -> T` (GET, authHeader, `check`, `JSONDecoder().decode`). Plus a `get` for wrapper-unwrapping where needed (or decode a small wrapper struct). Add:
    - `listKeys() -> [KeyMeta]` (GET `/v1/keys` → decode `{keys:[KeyMeta]}`)
    - `mintKey(label:) -> MintedKey` (POST `/v1/keys` body `{label}` → decode `MintedKey`; add a `post<T:Decodable>` or reuse `send` then decode)
    - `revokeKey(id:)` (DELETE `/v1/keys/{id}`)
    - `listUsers() -> [AdminUser]` (GET `/v1/admin/users` → `{users}`)
    - `setAllowed(uid:isAllowed:email:)` (PUT `/v1/admin/users/{uid}` body `{isAllowed[,email]}`)
    - `listAccessRequests() -> [AccessRequest]` (GET `/v1/admin/access-requests` → `{requests}`)
    - `decideAccessRequest(uid:decision:)` (POST `/v1/admin/access-requests/{uid}` body `{decision}`)
   Build the URLs against the REST base (note: these are NOT under `/v1/u/teams/...`; use `AppConfig.apiBaseURL + path`). Mirror `keys/client.ts`/`admin/client.ts`.
- [ ] **Step 3:** build + full suite (61 + new). Commit: `feat(ios): account/admin models + REST get + teamId logic with tests`

## Task 2: Team Firestore actions + listeners
**Files:** create `Data/TeamActions.swift`, `Features/Teams/TeamListeners.swift` (or extend `Listeners.swift`). Mirror `teams/actions.ts` + `teams/hooks.ts`. Build-verified.

- [ ] **Step 1:** `enum TeamActions` (`@MainActor` or static async), using `Firestore.firestore()` and `Auth.auth().currentUser`:
  - `createTeam(teamId:name:)`: `setData` on `teams/{teamId}` `{name, createdBy: uid, createdAt: serverTimestamp()}`, then `setData` on `teams/{teamId}/members/{uid}` `{uid, role:"owner", email, inviteId: NSNull(), joinedAt: serverTimestamp()}`.
  - `inviteMember(teamId:email:role:)`: `addDocument` to `teams/{teamId}/invites` `{email: lowercased, role, invitedBy: uid, status:"pending", createdAt: serverTimestamp()}`.
  - `revokeInvite(teamId:inviteId:)`: delete `teams/{teamId}/invites/{inviteId}`.
  - `acceptInvite(_:Invite)`: a `writeBatch` that sets `teams/{teamId}/members/{uid}` `{uid, role: invite.role, email: invite.email.lowercased, inviteId: invite.id, joinedAt: serverTimestamp()}` AND deletes the invite; `commit()`.
  - `declineInvite(_:Invite)`: delete the invite.
  - `changeRole(teamId:uid:role:)`: `updateData(["role": role.rawValue])` on the member.
  - `removeMember(teamId:uid:)`: delete the member doc.
  Use `FieldValue.serverTimestamp()`; throw on the underlying async errors.
- [ ] **Step 2:** Team listeners (reuse `CollectionStore`/`QueryListener`): `teamMembersQuery(teamId)` → `[Member]`; `teamInvitesQuery(teamId)` → `[Invite]` (stamp teamId); `myPendingInvitesQuery()` = `collectionGroup("invites").whereField("email", isEqualTo: currentUserEmailLowercased)` → `[Invite]` (teamId from `reference.parent.parent`). Provide small store(s) wrapping these.
- [ ] **Step 3:** build + suite green. Commit: `feat(ios): team Firestore actions + members/invites listeners`

## Task 3: TeamsView
**Files:** `Features/Teams/TeamsView.swift` (+ `TeamsStore.swift`, row subviews); update `AppShell.swift` to use it. Mirror `TeamsPage.tsx`/`MemberRow.tsx`/`InviteForm.tsx`/`InviteRow.tsx`/`PendingInviteRow.tsx`/`TeamCreateForm.tsx`.

- [ ] **Step 1:** `TeamsStore` (`@MainActor`): owns `myTeams: [TeamRef]` (a `collectionGroup("members") where uid==` listener — reuse the existing one from `DashboardStore`; extract a shared helper or a small `MyTeamsListener` both use) and `myPendingInvites`. Per-team member/invite data is owned by per-team child views/stores (a `TeamCardView` with its own `members`/`invites` listeners keyed by teamId).
- [ ] **Step 2:** `TeamsView` sections (mirror TeamsPage): Create-a-team (name → `TeamActions.createTeam(teamIdFromName(name), name)`); Pending invites (Accept/Decline → `acceptInvite`/`declineInvite`); Your teams (a `TeamCardView` per team).
- [ ] **Step 3:** `TeamCardView(teamId:role:)`: name + copyable team id; member rows per the spec's `MemberRow` rules (canManage/roleOptions/Leave); manager-only (`owner|admin`) invite form (email + role picker) and sent-invites list with revoke. A shared "run async action, capture error → ErrorNote" helper.
- [ ] **Step 4:** wire `AppShell` Teams tab to `TeamsView`. Build → SUCCEEDED, suite green. Commit: `feat(ios): Teams screen (create, invites, members)`

## Task 4: KeysView + AdminView
**Files:** `Features/Keys/KeysView.swift` (+`KeysStore.swift`), `Features/Admin/AdminView.swift` (+`AdminStore.swift`); update `AppShell.swift`. Mirror `KeysPage.tsx`/`AdminPage.tsx`.

- [ ] **Step 1:** `KeysStore` (`@MainActor`): `keys: [KeyMeta]`, `loading`, `error`, `revealedKey: String?`; `refresh()` (`RestClient.listKeys`), `mint(label:)` (`mintKey` → set `revealedKey` → refresh), `revoke(id:)` (`revokeKey` → refresh). `KeysView`: mint form (label + button), a reveal panel showing the secret once (copyable, dismiss), key list with revoke (confirm). Load on appear.
- [ ] **Step 2:** `AdminStore` (`@MainActor`): `users`, `requests`, `loading`, `error`; `refresh()` (concurrently `listUsers` + `listAccessRequests`), `grant(uid:email:)` (`setAllowed(uid,true,email)`→refresh), `decide(uid:approve:)` (`decideAccessRequest`→refresh), `toggle(uid:isAllowed:)` (`setAllowed`→refresh). `AdminView`: grant-by-uid form; access requests (approve/deny); all-users list (toggle allowed). Load on appear.
- [ ] **Step 3:** wire `AppShell` Keys + Admin tabs (Admin tab already gated by `auth.isAdmin`). Build → SUCCEEDED, suite green. Commit: `feat(ios): Keys + Admin screens (REST)`

## Task 5: Verify + code review
- [ ] **Step 1:** clean `xcodegen generate && xcodebuild test` → green (61 + new). Quote total.
- [ ] **Step 2:** holistic SP3b code review (diff vs the SP3b base); apply fixes; re-verify.
- [ ] **Step 3:** manual acceptance (needs secrets): create a team; invite + accept/decline; change role/remove + leave; mint key (revealed once) + revoke; admin grant/approve/deny/toggle; Admin tab hidden for non-admins.

## Done criteria
- `xcodebuild test` green (new: teamId logic, Firestore + REST model decoders).
- Teams (Firestore) + Keys/Admin (REST) screens functional; permission gating matches the web; no backend change.
