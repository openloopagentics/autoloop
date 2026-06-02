# Daloop UI — API-Key Management (UI-D) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase; decisions delegated to the implementer)

## Context

UI-A/B/C are merged. UI-D adds the `/keys` page: a signed-in user mints, lists, and
revokes their **per-user API keys** by calling the deployed `/v1/keys` endpoints
with their **Firebase ID token** (not an API key). Keys let agents report status
(Sub-project B): `POST /v1/keys` returns the plaintext **once**, `GET /v1/keys`
lists metadata, `DELETE /v1/keys/{id}` revokes.

Unlike the dashboard/teams (Firestore listeners + writes), this talks to the
**Cloud Functions HTTP API**, so it's plain `fetch` (one-shot loads, refreshed after
mint/revoke), not real-time.

## Key decisions

- **API base URL** from `import.meta.env.VITE_API_URL`, defaulting to the deployed
  function URL `https://api-5ds5e4zsxq-uc.a.run.app`. Add `VITE_API_URL` to
  `web/.env.example`.
- **Auth:** each request sends `Authorization: Bearer <idToken>` where the token is
  `await auth.currentUser.getIdToken()`. The API's `requireUser` verifies it +
  checks `isAllowed` (always true for a user already in the app).
- **Mint reveals once:** `POST /v1/keys` returns `{ id, key, label, prefix, createdAt }`.
  The UI shows the plaintext `key` in a one-time reveal panel with a copy button and
  a "store it now — it won't be shown again" warning; it is never persisted.
- **List is fetch-based** (not a Firestore listener): load on mount; refresh after a
  successful mint or revoke. (`apiKeys` is locked to clients in the rules, so it
  MUST go through the API, not Firestore.)

## Architecture (UI-A/B/C pattern)

- **Presentational components (props-only, tested):**
  - `KeyMintForm({ onMint })` — label input + "Create key".
  - `NewKeyReveal({ keyValue, onDismiss })` — shows the plaintext once, a copy
    button (`navigator.clipboard.writeText`), the warning, and a Dismiss.
  - `KeyRow({ keyMeta, onRevoke })` — `prefix…`, label, createdAt; Revoke.
  - `KeyList({ keys, onRevoke })` — rows or an empty state.
- **API client (glue — `web/src/keys/client.ts`, build-only):** `mintKey(label)`,
  `listKeys()`, `revokeKey(id)` — each resolves the ID token, builds the request,
  parses the `{ error: { code, message } }` envelope on failure into a thrown
  `Error(message)`. Imports `auth` from `firebase.ts`.
- **Page (thin glue — `KeysPage`):** holds `{ keys, loading, error, revealed }`
  state; loads via `listKeys()` on mount; `onMint` → `mintKey(label)` then set
  `revealed` to the returned `{key}` and refresh the list; `onRevoke` →
  `revokeKey(id)` then refresh. All client errors caught → inline `ErrorNote`.

## Behavior / states

- **Loading** the list → `Spinner` (reuse the dashboard component).
- **Error** (network / non-2xx) → `ErrorNote` with the API's message; the page stays
  usable (can retry mint).
- **Empty** → "No API keys yet — create one for your agents."
- **After mint** → `NewKeyReveal` shows the plaintext until dismissed; the list shows
  the new key's metadata (prefix/label) but never the plaintext.
- **Revoke** removes the key (refresh); revoking a key already gone → the API's 404,
  surfaced inline (harmless).

## Routing

`/keys` (replacing the `ComingSoon` placeholder) → `KeysPage`. The AppShell "API
Keys" nav link already points there.

## Testing

Vitest + jsdom + RTL. Unit-test the presentational components with fixtures +
injected callbacks: `KeyMintForm` calls `onMint(label)`; `NewKeyReveal` renders the
plaintext + a copy button (stub `navigator.clipboard`) + Dismiss (`onDismiss`);
`KeyRow` shows prefix/label and emits `onRevoke(id)`; `KeyList` empty vs populated.
The `client.ts` (fetch + ID token) and `KeysPage` (state/glue) are not unit-tested;
`npm run build` type-checks them.

**App.test firebase-free:** `App.tsx` statically imports `KeysPage`, whose chain
reaches `keys/client.ts` → `firebase.ts` (top-level `getAuth` throws on the blank
test env). So `App.test.tsx` must add a hoisted `vi.mock("./keys/client", …)`
(alongside the existing `./dashboard/hooks`, `./teams/hooks`, `./teams/actions`
mocks). `KeysPage` uses no hooks module to mock — only the client.

## Out of scope

- Showing/rotating an existing key's plaintext (impossible — only the hash is
  stored; mint a new one).
- Per-key usage stats / last-used (the API doesn't track it).
- Backend/rules/API changes.
