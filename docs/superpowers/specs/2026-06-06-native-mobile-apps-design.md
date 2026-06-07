# Autoloop Native Mobile Apps — Design

**Date:** 2026-06-06
**Status:** Approved (design phase)

## Context

Autoloop is a live status dashboard for AI-agent-built projects. The backend is a
write-only Cloud Functions REST API plus Firestore (with security rules), and the
existing client is a React + Vite + Firebase **web** app (`web/`). This initiative
adds **true-native mobile apps** — SwiftUI on iOS and Jetpack Compose on Android —
that reach **full parity** with the web app.

The architecture makes this tractable: the native apps are almost entirely
*consumers* of infrastructure that already exists.

- **Reads** are Firestore real-time listeners gated by `firestore.rules` + the
  `users/{uid}.isAllowed` allowlist. Native Firebase SDKs support these listeners
  natively — same data, same rules, **no backend change**.
- **Writes** all go through one Cloud Functions REST API (`/v1/...`) authenticated
  with a Firebase ID token (`Authorization: Bearer <idToken>`). Native apps need
  only an HTTP client + the auth token — **same API, no backend change**.
- The **only** backend addition is FCM push (a Cloud Function trigger + a
  device-token registration path), scoped to SP4.

### Decisions (from brainstorming)

- **Tech:** true native — SwiftUI (iOS) + Jetpack Compose (Android). Two codebases,
  no code sharing with the web app.
- **Scope:** full parity with the web app (all viewing **and** all write/admin
  surfaces).
- **Sequencing:** **iOS first**, then Android mirrors the proven design.
- **Auth:** Google sign-in only (mirrors the web exactly), same `isAllowed` gate.
- **Push:** add FCM real OS-level push notifications (new mobile value-add).
- **Repo layout:** same monorepo — add `ios/` and `android/` alongside `web/`,
  `functions/`, `cli/`.

## Decomposition

Full parity × two platforms is too large for one spec, so the initiative is split
into sub-projects, each with its own spec → plan → build cycle. **iOS first:**

- **SP1 — iOS walking skeleton** *(this spec covers SP1 in detail).* Scaffold,
  Firebase config, Google sign-in + allowlist gate, app shell/navigation, theming,
  and the data-layer plumbing proven end-to-end with one vertical read+write slice.
- **SP2 — iOS read surfaces:** dashboard list + all project-detail tabs
  (Vision / Loops / Bugs / Tests / Messages / Session Log), live.
- **SP3 — iOS write surfaces:** vision editing, project create/delete, messages,
  bugs, teams, keys, admin allowlist.
- **SP4 — FCM push:** Cloud Function trigger + device-token registration + iOS
  notification handling (the one backend change).
- **SP5 — Android:** mirror SP1–SP4 in Compose, reusing the now-proven
  data/domain design.

## Cross-cutting architecture (applies to both platforms)

Each native app is a thin client over the existing backend, in three layers:

1. **Data layer** — Firestore listeners for reads (mirroring `dashboard/hooks.ts`),
   a typed REST client for writes (mirroring `api.ts` / `client.ts`), Firebase
   Auth for Google sign-in + ID token. Model structs/data classes mirror
   `web/src/dashboard/types.ts`.
2. **Domain layer** — ports of the *pure* logic functions (`status.ts`,
   `scenarioState.ts`, `loopView.ts`). Platform-agnostic, 1:1 ports with their own
   unit tests against the same cases as the existing `.test.ts` files.
3. **UI layer** — SwiftUI / Compose, native navigation, the 6-theme system
   mirrored as a design-token palette.

### Relevant Firestore model (read path)

- `users/{uid}` — `isAllowed`, `isAdmin`.
- `teams/{teamId}` — `name`; `members` subcollection (collectionGroup query by
  `uid` → my teams + role).
- `teams/{teamId}/projects/{slug}` — project docs, with nested loops/phases/
  goals/scenarios/tasks/scores/testRuns/bugs/messages/documents/sessions.

### Write path

All writes are `fetch` to `${API_URL}/v1/...` with `Authorization: Bearer
<idToken>`; failures decode `{ error: { message } }`. Mirrors `web/src/dashboard/
api.ts`, `web/src/admin/client.ts`, `web/src/keys/client.ts`.

---

# SP1 — iOS Walking Skeleton (detailed design)

## What SP1 delivers

A runnable iOS app that proves every architectural seam end-to-end, with minimal
screen content:

- Launches, initializes Firebase, shows a themed loading state.
- Google sign-in → the full `loading → signed-out → pending → allowed` gate working
  against real `users/{uid}`.
- Once allowed, a native tab/nav shell with the real destinations (Dashboard,
  Teams, API keys, Admin-if-admin) — each tab a placeholder **except** one vertical
  slice.
- **The one real slice:** Dashboard lists your teams' projects via a live Firestore
  listener (proving reads + security rules + real-time), and a single write works
  end-to-end via the REST client (proving auth-token + API). The first wired write
  is `putProject` (rename/status) — idempotent and easy to observe.
- Theme picker (6 themes) + sign-out in a profile menu.

Out of scope for SP1 (deferred to SP2–SP4): full project-detail tabs, all other
write forms, teams/keys/admin management, FCM.

## Project structure & dependencies

```
ios/
  Autoloop.xcodeproj
  Autoloop/
    App/            AutoloopApp.swift, RootView.swift (gate switch)
    Auth/           AuthStore.swift (ObservableObject), AccessGate.swift (pure state machine)
    Data/
      Firebase.swift           (configure)
      FirestoreListeners.swift (generic listener -> @Published)
      RestClient.swift         (typed write client, Bearer token)
      Models.swift             (Codable structs mirroring types.ts)
    Domain/         Status.swift, ScenarioState.swift, LoopView.swift (ports of pure TS)
    UI/
      Theme.swift              (6-theme token palette + persistence)
      AppShell.swift           (TabView / NavigationStack)
      Components/              (StatusBadge, Spinner, LoopMark, EmptyState, ...)
    Features/
      Dashboard/  DashboardView.swift, DashboardStore.swift
      (Teams/Keys/Admin = placeholder views in SP1)
  AutoloopTests/    AccessGateTests, domain-port tests
```

- **Dependencies** via Swift Package Manager: `firebase-ios-sdk` (Auth, Firestore)
  and `GoogleSignIn-iOS`.
- **Config:** `GoogleService-Info.plist` (gitignored; committed `.example`), and the
  API base URL in an xcconfig (mirrors `VITE_API_URL`).
- **Minimum iOS target:** iOS 16 (NavigationStack, modern SwiftUI).

## Auth gate (direct port)

`AccessGate.swift` is a pure function mirroring `deriveAccess` exactly — same
`loading / signed-out / pending / allowed` states, same flash-prevention rule
(don't show "pending" before the user doc resolves). `AuthStore` is an
`ObservableObject` that:

- listens to Firebase `addStateDidChangeListener`,
- on a signed-in user, attaches a `users/{uid}` snapshot listener for
  `isAllowed` / `isAdmin` (tearing it down on user change, exactly like the web's
  `unsubDoc` ref),
- exposes `signIn()` (GoogleSignIn → Firebase credential) and `signOut()`.

`RootView` switches on the state: loading spinner / `SignInView` /
`RequestAccessView` / `AppShell` — the same four-way branch as `App.tsx`.

## Navigation shell

Native `TabView` (iOS-idiomatic, replacing the web top-nav): **Dashboard · Teams ·
Keys**, with **Admin** appended only when `isAdmin`. A profile entry point (toolbar
avatar) opens a sheet with "Signed in as", the 6-theme picker, Getting Started, and
Sign out — mirroring the web profile menu. Using a bottom `TabView` instead of the
web's hamburger is a deliberate platform adaptation, not a feature divergence.

## Data layer & theming

- **Reads:** a small generic helper wraps Firestore `addSnapshotListener` into
  `@Published` arrays/objects with `loading` / `error`, mirroring the `Result<T>`
  shape from `hooks.ts`. SP1 implements `useMyTeams` (collectionGroup on `members`)
  + `useTeamProjects` to drive the Dashboard.
- **Writes:** `RestClient` mirrors `api.ts` — builds `/v1/...` URLs, attaches
  `Authorization: Bearer <idToken>`, decodes the `{ error: { message } }` shape on
  failure into a thrown Swift error. SP1 wires exactly one call (`putProject`).
- **Models:** `Codable` structs mirroring `types.ts`. Firestore timestamps and the
  loose `unknown` fields are handled with a small decoding shim.
- **Theming:** `Theme.swift` defines the 6 palettes (Espresso / Daylight /
  Midnight / Forest / Nord / Rosé) as colour tokens, persisted in `UserDefaults`
  (the `localStorage` equivalent), applied via the SwiftUI environment.

## Error handling

- Listener errors surface into the store's `error` field and render an inline error
  note (mirrors the web's `ErrorNote`), never a crash.
- Sign-in cancellation (user dismisses the Google sheet) is swallowed silently, as
  on the web; real failures set `signInError`.
- REST failures throw a typed error carrying the server `message`; the calling view
  shows it inline.

## Testing & "done"

- **Unit tests:** `AccessGate` state machine (all branches, port of `gate.test.ts`)
  and the domain ports (`status` / `scenarioState` / `loopView`) against the same
  cases as their `.test.ts` files.
- **Manual acceptance for SP1:** sign in with a Google account → see *pending* if
  not allowlisted → flip the allowlist → land on Dashboard → see real projects
  update live → perform the one write and watch it reflect.
- The data-layer/listener helpers are kept thin and protocol-backed so later SPs
  can test stores against fakes.

## Why this ordering

The skeleton de-risks the whole initiative: auth, security-rules-as-a-mobile-client,
live listeners, the write path, and theming are all proven before breadth is built
in SP2+. SP5 (Android) then mirrors a design already validated on a real platform.
