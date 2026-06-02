# Daloop UI — Status Dashboard (UI-B) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase; decisions delegated to the implementer)

## Context

UI-A shipped the SPA shell + auth (the `AuthProvider`/`useAuth` seam, four-state
gate, `AppShell` with nav placeholders). UI-B is the **read-only status
dashboard** — Daloop's core purpose: show the signed-in user's teams → projects →
phases → commits, **live via Firestore real-time listeners**. No writes.

Builds on the deployed data model and rules:
- `teams/{teamId}` (read if member), `teams/{teamId}/members/{uid}` (read own via a
  collection-group query; read others if member), `teams/{teamId}/projects/{slug}`,
  `.../phases/{phaseId}`, `.../commits/{sha}` — all readable by team members.
- The `collectionGroup('members')` index on `uid` (already declared) powers
  "which teams am I in?".

## Approach & seam

Follow UI-A's pattern: **Firebase touches only a small hooks module; presentational
components take plain props and are unit-tested with fixtures.** The data hooks
(`useMyTeams`, `useTeamProjects`, `useProject`, `usePhases`, `useCommits`) are thin
`onSnapshot` glue (not unit-tested, like `AuthProvider` — verified by build); the
pages compose hooks + components; the components hold all the testable rendering.

## Routes (inside `AppShell`)

- **`/dashboard`** — `DashboardHome`: lists the user's teams; under each team, its
  projects as cards (title, status badge, current-phase name). Empty states: no
  teams → "You're not on a team yet"; team with no projects → "No projects yet".
- **`/dashboard/:teamId/:slug`** — `ProjectDetail`: project header (title, status,
  `design` shown as preformatted text, or a link when `format === "url"`); the
  ordered **phases** (by `order`), each with a status badge and started/ended
  times; under each phase, its **commits** (short sha, message, author,
  committedAt). Live.
- The `AppShell` "Dashboard" nav link points to `/dashboard`. The index route
  (`/`) redirects to `/dashboard`.

## Data hooks (Firebase glue — `web/src/dashboard/hooks.ts`)

Each returns `{ data, loading, error }` and lives behind `onSnapshot`:

- `useMyTeams()` → `collectionGroup(db, "members")` where `uid == auth.uid`, live →
  `[{ teamId, role }]` (teamId from the parent path: `snap.ref.parent.parent.id`).
  Then a per-team team-doc read for the name (or read lazily in the team section).
- `useTeamProjects(teamId)` → live collection on `teams/{teamId}/projects`.
- `useProject(teamId, slug)` → live doc.
- `usePhases(teamId, slug)` → live `phases` collection, `orderBy("order")`.
- `useCommits(teamId, slug, phaseId)` → live `commits` collection,
  `orderBy("committedAt", "desc")` (fallback: `createdAt`).

All listeners unsubscribe on unmount / dependency change. Errors set `error` (shown
as an inline message, not a crash). These are firebase glue, not unit-tested.

## Presentational components (`web/src/dashboard/components/` — unit-tested)

Pure, props-only, no Firebase:

- `StatusBadge({ status })` — colored label per the 7-status enum.
- `ProjectCard({ teamId, project })` — title, `StatusBadge`, current-phase line; links
  to the detail route.
- `TeamSection({ team, projects })` — team name + its `ProjectCard`s (or an empty
  state).
- `ProjectHeader({ project })`, `PhaseItem({ phase, commits })`,
  `CommitItem({ commit })`, `EmptyState({ message })`, `ErrorNote({ message })`,
  `Spinner()`.

Each is unit-tested with fixtures (status colors; empty/loaded/error rendering; the
ProjectCard link target; phases render in order with their commits; commit fields).

## Pages (thin glue — `web/src/dashboard/`)

- `DashboardHome` composes `useMyTeams` + `useTeamProjects` per team + `TeamSection`.
- `ProjectDetail` reads route params, composes `useProject`/`usePhases`/`useCommits`
  + the header/phase/commit components. Both render `Spinner`/`ErrorNote`/empty
  states from the hook results.

Pages are thin (hook → components); the rendering logic they delegate to is tested.

## Testing

Vitest + jsdom + RTL (UI-A harness). Test the **presentational components** with
fixtures: StatusBadge per status; ProjectCard content + link href; TeamSection
empty vs populated; ProjectHeader (markdown vs url design); PhaseItem renders its
commits in order; CommitItem fields; EmptyState/ErrorNote/Spinner. Pages and hooks
(Firebase glue) are not unit-tested (consistent with UI-A); `npm run build` type-checks
the whole tree. (A later emulator/Playwright smoke can exercise the live hooks.)

## Out of scope

- Any writes / management (teams, invites, keys, allowlist — UI-C/D/E).
- Markdown rendering of `design` (shown as preformatted text / link for now).
- Pagination/virtualization of large commit lists (YAGNI; note for later).
- Backend, rules, CLI changes.
