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

- **Same-origin via a scoped Hosting rewrite (avoids CORS).** The deployed function
  is `onRequest({ cors: false })`; a cross-origin browser fetch from the Hosting
  domain to the `*.run.app` URL with an `Authorization` header triggers a CORS
  preflight that the function would reject — blocking it 100%. So the UI calls the
  API **same-origin**: add a Hosting rewrite **`/v1/** → the `api` function**,
  ordered BEFORE the SPA catch-all, and have the client use a **relative** base
  (`VITE_API_URL` defaults to `""`, i.e. requests go to `/v1/keys` on the Hosting
  origin). No CORS, no preflight, no backend change. (This intentionally revises
  UI-A's "no `/v1` rewrite" note — that predated the browser needing the API; the
  scoped, first-ordered `/v1/**` rewrite routes API calls to the function and the
  catch-all still serves the SPA for everything else. Agents/CLI keep using the
  direct `*.run.app` URL, server-to-server, unaffected.)
- **Base-URL handling:** the client uses `(import.meta.env.VITE_API_URL ?? "")` with
  any trailing slash trimmed, so `${base}/v1/keys` is correct for both the default
  (`"" → /v1/keys`) and an explicit absolute override (e.g. an emulator/preview URL).
- **Auth:** each request sends `Authorization: Bearer <idToken>` where the token is
  resolved **per request** via `await auth.currentUser.getIdToken()` (the SDK caches
  and auto-refreshes near expiry — fine for a long-open page). The API's
  `requireUser` verifies it + checks `isAllowed`.
- **Mint reveals once:** `POST /v1/keys` returns `{ id, key, label, prefix, createdAt }`.
  The UI shows the plaintext `key` in a one-time reveal panel with a copy button and
  a "store it now — it won't be shown again" warning; never persisted (cleared on
  dismiss/unmount).
- **List is fetch-based** (not a Firestore listener): `GET /v1/keys` returns
  **`{ keys: [...] }`** — the client returns `body.keys`. Load on mount; refresh
  after a successful mint or revoke. (`apiKeys` is locked to clients in the rules,
  so it MUST go through the API, not Firestore.)

## Architecture (UI-A/B/C pattern)

- **Presentational components (props-only, tested):**
  - `KeyMintForm({ onMint, pending })` — label input + "Create key"; the button is
    disabled while `pending` (prevents a double-submit minting two keys).
  - `NewKeyReveal({ keyValue, onDismiss })` — shows the plaintext once, a copy
    button (`navigator.clipboard.writeText`), the warning, and a Dismiss.
  - `KeyRow({ keyMeta, onRevoke })` — `prefix…`, label, createdAt; Revoke.
  - `KeyList({ keys, onRevoke })` — rows or an empty state.
- **API client (glue — `web/src/keys/client.ts`, build-only):** `mintKey(label)` →
  the `{id,key,label,prefix,createdAt}` object; `listKeys()` → **`body.keys`** (the
  array, unwrapped); `revokeKey(id)`. Each resolves the ID token, builds the
  request against the trimmed base, and on a non-2xx parses the
  `{ error: { code, message } }` envelope into a thrown `Error(message)`. Imports
  `auth` from `firebase.ts`.
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

## Testing

Vitest + jsdom + RTL. Unit-test the presentational components with fixtures +
injected callbacks: `KeyMintForm` calls `onMint(label)`; `NewKeyReveal` renders the
plaintext + a copy button (stub `navigator.clipboard`) + Dismiss (`onDismiss`);
`KeyRow` shows prefix/label and emits `onRevoke(id)`; `KeyList` empty vs populated.
The `client.ts` (fetch + ID token) and `KeysPage` (state/glue) are not unit-tested;
`npm run build` type-checks them.

**App.test firebase-free:** `App.tsx` statically imports `KeysPage`, whose chain
reaches `keys/client.ts` → `firebase.ts` (top-level `getAuth` throws on the blank
test env). So `App.test.tsx` must add a hoisted `vi.mock("./keys/client", () => ({
mintKey: vi.fn(), listKeys: () => Promise.resolve([]), revokeKey: vi.fn() }))`
(exporting all three names `KeysPage` imports), alongside the existing
`./dashboard/hooks`, `./teams/hooks`, `./teams/actions` mocks. `KeysPage` uses no
hooks module — only the client.

## Routing + Hosting rewrite

`/keys` (replacing the `ComingSoon` placeholder) → `KeysPage`. AND update
`firebase.json` hosting `rewrites` so `/v1/**` routes to the function **before** the
SPA catch-all (gen2 function → use the Cloud Run form):
```json
"rewrites": [
  { "source": "/v1/**", "run": { "serviceId": "api", "region": "us-central1" } },
  { "source": "**", "destination": "/index.html" }
]
```

## Out of scope

- Showing/rotating an existing key's plaintext (impossible — only the hash is
  stored; mint a new one).
- Per-key usage stats / last-used (the API doesn't track it).
- Backend/rules/API changes.
