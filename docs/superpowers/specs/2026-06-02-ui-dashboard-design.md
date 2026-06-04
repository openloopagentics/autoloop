# Autoloop UI — Status Dashboard (UI-B) — Design

**Date:** 2026-06-02
**Status:** Approved (design phase; decisions delegated to the implementer)

## Context

UI-A shipped the SPA shell + auth (the `AuthProvider`/`useAuth` seam, four-state
gate, `AppShell` with nav placeholders). UI-B is the **read-only status
dashboard** — Autoloop's core purpose: show the signed-in user's teams → projects →
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

## Status enum + colors (pure, tested — `web/src/dashboard/status.ts`)

The 7 statuses and their badge colors are a pure table/function `statusColor(status)`:

| status | color (class) |
|---|---|
| queued | gray |
| running | blue |
| blocked | red |
| paused | amber |
| completed | green |
| failed | red |
| cancelled | gray |

`statusColor` is unit-tested for all 7 values (+ a safe default for an unknown
string). Kept out of the Firebase layer so the "status colors" test is trivial.

## Data hooks (Firebase glue — `web/src/dashboard/hooks.ts`)

Each returns `{ data, loading, error }` and lives behind `onSnapshot`; all listeners
unsubscribe on unmount / dependency change; errors set `error` (shown inline, never
a crash). These are Firebase glue, **not unit-tested** (consistent with UI-A).

- `useMyTeams()` → `collectionGroup(db, "members")` **`where("uid", "==", auth.uid)`**
  (this `where` is **load-bearing for rules compliance** — the rules only permit a
  user to read their OWN member docs across teams; broadening/removing it makes the
  whole query fail, not over-fetch). Live → `[{ teamId, role }]`, with
  `teamId = snap.ref.parent.parent?.id` (parent = `members` collection,
  parent.parent = team doc; guard the nullable `parent.parent`).
- `useTeamProjects(teamId)` → live collection on `teams/{teamId}/projects`.
- `useTeam(teamId)` → live team doc (for the name).
- `useProject(teamId, slug)` → live doc; **returns `data: null` when
  `!snapshot.exists()`** (distinct from `undefined` = still loading) so the detail
  page can show a "not found" state.
- `usePhases(teamId, slug)` → live `phases` collection, `orderBy("order")` (`order`
  is always set on phase create, so no docs are dropped).
- `useCommits(teamId, slug, phaseId)` → live `commits` collection,
  **`orderBy("createdAt", "desc")`** — `createdAt` is server-stamped on every commit,
  so ordering by it drops nothing. (Do NOT order by `committedAt`: it's optional, and
  Firestore `orderBy` excludes docs missing the field. `committedAt` is still
  displayed, just not used for ordering.)

## Presentational components (`web/src/dashboard/components/` — unit-tested)

Pure, props-only, no Firebase:

- `StatusBadge({ status })` — label colored via `statusColor`.
- `ProjectCard({ teamId, project })` — title, `StatusBadge`, and the **current phase
  from `project.currentPhaseId`** (the server-maintained field — no derivation, no
  extra listener); shows "no active phase" when it's null. Links to the detail route.
- `TeamSection({ team, projects, loading, error })` — **props-only/tested**: team name +
  its `ProjectCard`s, or `Spinner`/`ErrorNote`/empty ("No projects yet"). It does NOT
  call any hook.
- `ProjectHeader({ project })` — title, `StatusBadge`, and `design`: a link when
  `project.design?.format === "url"`, otherwise the content as preformatted text;
  nothing when there's no design.
- `PhaseItem({ phase, commits })` — phase name + `StatusBadge` + started/ended; its
  commits, or "No commits yet" when empty.
- `CommitItem({ commit })` — short sha, message, author, committedAt (if present).
- `EmptyState({ message })`, `ErrorNote({ message })`, `Spinner()`.

## Pages / containers (thin Firebase glue — not unit-tested)

- `DashboardHome` calls `useMyTeams()` once, then renders one
  **`<TeamSectionContainer team={t} key={t.teamId} />` per team** (keyed by `teamId`).
  `TeamSectionContainer` calls `useTeam(teamId)` + `useTeamProjects(teamId)` **once
  each** (fixed hook count per component → no rules-of-hooks violation) and passes
  `{ team, projects, loading, error }` to the presentational `TeamSection`.
  `DashboardHome` shows its own `Spinner`/`ErrorNote` and the no-teams empty state.
- `ProjectDetail` reads `:teamId`/`:slug`, calls `useProject`/`usePhases`/`useCommits`
  (one `useCommits` per phase via a keyed `<PhaseItemContainer phase={p} />` child, so
  again a fixed hook count per component), and renders header + phases. `data === null`
  (or malformed params) → "Project not found" `EmptyState`; loading → `Spinner`;
  error → `ErrorNote`; no phases → "No phases yet".

The per-team / per-phase container split keeps every component's hook count fixed;
the containers are thin glue (untested), the presentational pieces they wrap are tested.

## Testing

Vitest + jsdom + RTL (UI-A harness). Test the pure `statusColor` (all 7 + default)
and the **presentational components** with fixtures: StatusBadge per status;
ProjectCard content + current-phase line (incl. null) + link `href`; TeamSection
loading/error/empty/populated; ProjectHeader url-design (link) vs non-url
(preformatted) vs none; PhaseItem with commits in order and the empty-commits case;
CommitItem fields; EmptyState/ErrorNote/Spinner. Pages, containers, and hooks
(Firebase glue) are not unit-tested; `npm run build` type-checks the whole tree.

## Out of scope

- Any writes / management (teams, invites, keys, allowlist — UI-C/D/E).
- Markdown rendering of `design` (shown as preformatted text / link for now).
- Pagination/virtualization of large commit lists (YAGNI; note for later).
- Backend, rules, CLI changes.
