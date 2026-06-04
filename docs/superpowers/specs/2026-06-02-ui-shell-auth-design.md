# Autoloop UI — App Shell & Auth (UI-A) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase)

## Context

The Autoloop backend (multi-tenant REST API + Firestore rules) is built and
deployed, and agents report via the CLI. The remaining major piece is the
**web UI**, decomposed into sub-projects:

- **UI-A (this spec):** the frontend app itself — framework/hosting, Google
  sign-in, the `isAllowed` access gate, the authenticated shell, and deploy.
- **UI-B:** the read-only status dashboard (live Firestore listeners).
- **UI-C:** team / membership / invite management.
- **UI-D:** API-key management (mint/list/revoke via `/v1/keys`).
- **UI-E:** admin allowlist management.

UI-A is the foundation every later piece mounts inside. It establishes the
**`useAuth()` seam** that the rest of the UI builds on.

## Stack

- **Vite + React + TypeScript SPA**, deployed to **Firebase Hosting** (static).
  No SSR: the whole app is behind Google login and driven by Firestore real-time
  listeners, so server rendering adds nothing. Same Firebase project as the API.
- Firebase **web SDK** for Auth (Google) + Firestore reads. The only server calls
  (later, UI-D) are to the `/v1/keys` Cloud Functions API with the user's ID token.
- Routing via `react-router`. Tests via **Vitest + jsdom + React Testing Library**.

## Repo layout

A new top-level `web/` package (sibling to `functions/`):

```
web/
  src/
    firebase.ts            # initializeApp(webConfig) -> exports auth, db (Firestore)
    auth/AuthProvider.tsx  # THE seam: subscribes to onAuthStateChanged + users/{uid};
                           # provides useAuth() -> { state, user, isAllowed, signIn, signOut }
                           # (state = deriveAccess(...): loading|signed-out|pending|allowed)
    auth/gate.ts           # pure deriveAccess(...) -> "loading"|"signed-out"|"pending"|"allowed"
    routes/
      AppShell.tsx         # authenticated layout: top bar + nav + <Outlet/>
      Home.tsx             # landing stub inside the shell
      SignIn.tsx           # Google sign-in screen
      RequestAccess.tsx    # shown to signed-in-but-not-allowed users
    App.tsx                # root: reads useAuth(), renders by access state + router
    main.tsx
  index.html
  vite.config.ts           # incl. vitest config (jsdom)
  package.json
  .env.example             # VITE_FIREBASE_* web config keys
```

- **`firebase.ts`** initializes the Firebase web app from `import.meta.env.VITE_FIREBASE_*`
  (public client config, not secrets). Exports `auth` and `db`.
- **`AuthProvider`** is the only component that touches Firebase auth/Firestore.
  Everything else consumes `useAuth()`, so components are testable without Firebase.
  Its contract:
  - Tracks two flags — `authResolved` (set on the first `onAuthStateChanged`) and
    `userDocResolved` (set on the first `users/{uid}` snapshot **or error**) — and
    feeds them, with `user`/`isAllowed`, to `deriveAccess`. `loading` is never a raw
    field; it's just `deriveAccess(...) === "loading"`.
  - **Listener lifecycle:** on every `onAuthStateChanged`, tear down any prior
    `users/{uid}` `onSnapshot`, reset `userDocResolved=false` and `isAllowed=false`,
    then attach the new listener (only if there's a user). This prevents a stale
    prior-uid listener from firing post-sign-out and stops a previous session's
    `isAllowed` from leaking into a new one.
  - **Snapshot errors:** the `onSnapshot` error callback sets `userDocResolved=true`
    and `isAllowed=false` (→ `pending`, not a stuck spinner) and logs; a transient
    `permission-denied` during sign-out teardown is thus harmless.
  - **signIn/signOut errors:** `signIn` catches `signInWithPopup` rejections
    (`popup-closed-by-user`, `popup-blocked`, `cancelled-popup-request`, network)
    and surfaces a message on the SignIn screen with a retry; it does NOT throw
    unhandled. (`popup-blocked` may fall back to `signInWithRedirect` — implementer's
    call.) `signOut` failures are caught and logged.
- **`gate.ts`** is pure (no Firebase) — `deriveAccess` (above) is unit-testable in
  isolation, including the flash-prevention branch.

## Auth gate states & routing

There are **two independent resolutions** — Firebase auth resolving, and the first
`users/{uid}` snapshot arriving — and the gate must not show `pending` in the gap
between them (that would flash the RequestAccess screen before the doc loads). So
`gate.ts` takes BOTH signals and derives the state (including `loading`) itself:

```
deriveAccess({ authResolved, user, userDocResolved, isAllowed }) ->
  !authResolved                          -> "loading"
  authResolved && !user                  -> "signed-out"
  user && !userDocResolved               -> "loading"   // flash-prevention branch
  user && userDocResolved && isAllowed   -> "allowed"
  else                                   -> "pending"
```

| State | Renders |
|---|---|
| `loading` | spinner (until BOTH auth and the first user-doc snapshot/error resolve) |
| `signed-out` | **SignIn** (Google button → `signInWithPopup`) |
| `pending` | **RequestAccess** showing the user's **email + uid** (selectable / copy-to-clipboard, since they relay the uid to an admin) |
| `allowed` | **AppShell** + routed pages |

`useAuth()` exposes `{ state, user, isAllowed, signIn, signOut }` where `state` is
the `deriveAccess` result (the provider computes it from the two resolution flags;
components only ever see the four-state `state`, never the raw flags).

- `isAllowed` comes from a **real-time listener on `users/{uid}`** (the rules
  permit a user to read their own doc). When an admin flips `isAllowed`, the UI
  advances `pending` → `allowed` live, no reload.
- A new user with no `users/{uid}` doc reads "not found" — an allowed, EMPTY
  snapshot (not a permission error) → `userDocResolved=true`, `isAllowed=false` →
  `pending`. **Provisioning is manual/out-of-band** (admin sets the doc; UI-E
  later) — the client never writes `users/`, consistent with the current rules.
- `react-router`: the `allowed` area is a layout route (`AppShell`) with
  placeholder child routes for Dashboard / Teams / API Keys (stubs now; filled by
  UI-B/C/D). UI-A's only real page is a `Home` landing stub.

## App shell

`AppShell`: a top bar with the **Autoloop** name, the signed-in user's **email**,
and a **Sign out** button (calls `useAuth().signOut`); a **nav** with
**Dashboard · Teams · API Keys** links rendered as stubs/placeholders now (each
lights up when its sub-project lands); and a main `<Outlet/>` for the routed page.

## Config & deploy

- **Firebase web config** in `web/.env` (`VITE_FIREBASE_API_KEY`, `…AUTH_DOMAIN`,
  `…PROJECT_ID`, `…STORAGE_BUCKET`, `…MESSAGING_SENDER_ID`, `…APP_ID`), with a
  committed `web/.env.example`. Public client config, not secrets.
- **`firebase.json`** gains a `hosting` block: `public: "web/dist"`, ignore the
  usual, an SPA rewrite (`source: "**" → destination: "/index.html"`), and a
  **`predeploy` hook** that builds the SPA (`npm --prefix web run build`) so a bare
  `firebase deploy` never publishes a stale/missing `dist`. The existing
  `functions`/`firestore` config is unchanged. **No `/v1/**` Hosting rewrite to the
  function** — the API is called by its own Cloud Functions URL, so the catch-all
  SPA rewrite cannot swallow API routes (relevant when UI-D calls `/v1/keys`).
- **Repo tooling:** `web/` is an independent package (its own `package.json` +
  Vitest config); there is **no npm-workspaces root**, so `web` and `functions` are
  installed/tested separately.
- **Build & deploy:** `cd web && npm install && npm run build` → `web/dist`;
  `firebase deploy --only hosting` (the predeploy hook rebuilds).
- **One-time console setup (documented):** enable the **Google** sign-in provider
  in Firebase Auth, and add both the Hosting domain(s) **and `localhost`** to the
  **authorized domains** (the latter so `signInWithPopup` works in `vite dev`).
- **Note:** the `VITE_FIREBASE_*` values (incl. the API key) are a public project
  *identifier*, not an auth secret — access is enforced by Firestore rules, not by
  hiding the config.

## Testing

Vitest + jsdom + React Testing Library; Firebase mocked at the `useAuth` seam.

- **`gate.ts` (pure):** `deriveAccess` for every branch — `!authResolved` → loading;
  authResolved + no user → signed-out; **user + `!userDocResolved` → loading
  (flash-prevention)**; user + resolved + `isAllowed:true` → allowed; user +
  resolved + missing-doc/`isAllowed:false` → pending.
- **Gate rendering:** render `App` wrapped in a test `AuthContext.Provider` set to
  each `state`; assert SignIn / RequestAccess (shows email + uid) / AppShell render
  respectively. No Firebase import in these tests.
- **AppShell:** renders the nav links + the user's email; **Sign out** invokes the
  injected `signOut`.

The flash-prevention, listener-teardown, and error handling now live in the pure
`gate.ts` (decision) plus a small, explicitly-specified `AuthProvider` contract.
Because the error-prone decision logic is in the tested pure layer, leaving the
provider's thin Firebase glue (`onAuthStateChanged` + `onSnapshot` wiring) without
its own test is acceptable; a Playwright/emulator smoke is deferred to a later
sub-project.

## Out of scope (later UI sub-projects / elsewhere)

- The dashboard, team/membership/invite management, API-key minting, admin
  allowlist (UI-B/C/D/E).
- Any change to the backend, Firestore rules, or the CLI.
- Self-service access requests / an auth-trigger to auto-create user docs
  (provisioning stays manual for now).
- E2E/emulator browser tests.
