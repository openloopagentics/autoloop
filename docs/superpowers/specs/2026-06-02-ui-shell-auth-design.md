# Daloop UI — App Shell & Auth (UI-A) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase)

## Context

The Daloop backend (multi-tenant REST API + Firestore rules) is built and
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
                           # provides useAuth() -> { user, isAllowed, loading, signIn, signOut }
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
- **`gate.ts`** is pure (no Firebase), so the access decision is unit-testable in
  isolation.

## Auth gate states & routing

`useAuth()` exposes `{ user, isAllowed, loading, signIn, signOut }`. The pure
`deriveAccess({ loading, user, isAllowed })` returns one of four states; `App`
renders accordingly:

| State | Condition | Renders |
|---|---|---|
| `loading` | auth/user-doc not resolved yet | spinner |
| `signed-out` | no Firebase user | **SignIn** (Google button → `signInWithPopup`) |
| `pending` | signed in, but `users/{uid}` missing or `isAllowed !== true` | **RequestAccess** showing the user's **email + uid** to send an admin |
| `allowed` | signed in + `isAllowed === true` | **AppShell** + routed pages |

- `isAllowed` comes from a **real-time listener on `users/{uid}`** (the security
  rules already permit a user to read their own doc). When an admin flips
  `isAllowed`, the UI advances `pending` → `allowed` live, no reload.
- A new user with no `users/{uid}` doc reads "not found" (an allowed, empty read)
  → `pending`. **Provisioning is manual/out-of-band** (admin sets the doc; UI-E
  later) — the client never writes `users/`, consistent with the current rules.
- `react-router`: the `allowed` area is a layout route (`AppShell`) with
  placeholder child routes for Dashboard / Teams / API Keys (stubs now; filled by
  UI-B/C/D). UI-A's only real page is a `Home` landing stub.

## App shell

`AppShell`: a top bar with the **Daloop** name, the signed-in user's **email**,
and a **Sign out** button (calls `useAuth().signOut`); a **nav** with
**Dashboard · Teams · API Keys** links rendered as stubs/placeholders now (each
lights up when its sub-project lands); and a main `<Outlet/>` for the routed page.

## Config & deploy

- **Firebase web config** in `web/.env` (`VITE_FIREBASE_API_KEY`, `…AUTH_DOMAIN`,
  `…PROJECT_ID`, `…STORAGE_BUCKET`, `…MESSAGING_SENDER_ID`, `…APP_ID`), with a
  committed `web/.env.example`. Public client config, not secrets.
- **`firebase.json`** gains a `hosting` block: `public: "web/dist"`, ignore the
  usual, and an SPA rewrite (`source: "**" → destination: "/index.html"`). The
  existing `functions`/`firestore` config is unchanged.
- **Build & deploy:** `cd web && npm install && npm run build` → `web/dist`;
  `firebase deploy --only hosting`.
- **One-time console setup (documented):** enable the **Google** sign-in provider
  in Firebase Auth and add the Hosting domain(s) to the **authorized domains**.

## Testing

Vitest + jsdom + React Testing Library; Firebase mocked at the `useAuth` seam.

- **`gate.ts` (pure):** `deriveAccess` for every state — unresolved → loading;
  no user → signed-out; user + missing doc → pending; user + `isAllowed:false` →
  pending; user + `isAllowed:true` → allowed.
- **Gate rendering:** render `App` wrapped in a test `AuthContext.Provider` set to
  each state; assert SignIn / RequestAccess (shows email + uid) / AppShell render
  respectively. No Firebase import in these tests.
- **AppShell:** renders the nav links + the user's email; **Sign out** invokes the
  injected `signOut`.

The `AuthProvider`'s real Firebase wiring (`onAuthStateChanged` + the `users/{uid}`
`onSnapshot`) is thin glue over the tested pieces. A Playwright/emulator smoke is
deferred to a later sub-project.

## Out of scope (later UI sub-projects / elsewhere)

- The dashboard, team/membership/invite management, API-key minting, admin
  allowlist (UI-B/C/D/E).
- Any change to the backend, Firestore rules, or the CLI.
- Self-service access requests / an auth-trigger to auto-create user docs
  (provisioning stays manual for now).
- E2E/emulator browser tests.
