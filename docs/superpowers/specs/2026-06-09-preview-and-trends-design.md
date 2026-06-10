# Autoloop — Preview URLs + cross-loop trends design spec

**Date:** 2026-06-09
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** 5 of 6 in the self-evolution batch. Surfaces the *product* (a per-loop
preview link the user can open) and the *trajectory* (per-loop trend sparklines —
scenarios met, composite, bugs, token spend) so the dashboard answers "is each loop
actually improving the product, and at what cost?" — the self-evolution scorecard.

## Goal

The dashboard tracks the build process but never shows the thing being built, and every
loop's outcome is viewed in isolation — there is no way to see whether loop 7 made the
product better than loop 6 or how much it cost. Commits already carry per-subagent
token usage (`commit.tokens`); loops already scope their own scores/test-runs/bugs.
This spec adds one tiny contract field and derives everything else client-side.

**Preview source (user decision): agent-supplied URL.** The contract stores a URL; the
driver skill says "deploy however this project deploys and report it" (Firebase
hosting preview channels documented as one recipe). Screenshots are deferred (they need
Firebase Storage — flagged as future work).

## Architecture

- **Contract (additive, one field):** optional `loop.previewUrl` on `loopBody` —
  validated URL, nullable to clear, exactly like `commit.url`.
- **Web (zero further contract change):** a pure `trendView.ts` module derives per-loop
  series from data the web can already read; a `TrendsStrip` renders inline-SVG
  sparklines on the Dashboard tab (no chart library — the house has none and four tiny
  sparklines don't justify one). Trend data requires reading run data for **all** loops
  (today's hooks read one selected loop), so a bounded fan-out hook reads the most
  recent `TREND_LOOPS_MAX = 20` loops; older loops are silently outside the window
  **and the strip labels the window** ("last 20 loops") per the no-silent-truncation
  rule.

No rules change; no new collections.

## Contract

`functions/src/schemas.ts` — `loopBody` gains:

```ts
  previewUrl: z.string().url().nullable().optional(),
```

`loops.ts` service: set/clear like other optional fields (`null` deletes the key,
mirroring `commit.url` handling). CLI: `autoloop loop set <id> --preview-url <url>`
(and `--preview-url ""` clears). Sync the three CLI copies.

## Web

### Preview link

- `Loop` type + `useLoops` already deliver the loop doc; add `previewUrl?`.
- **`LoopSnapshot`** (dashboard) and **`LoopRow`/`LoopDetail`** (Loops tab): an
  "Open preview ↗" anchor (`target="_blank" rel="noopener noreferrer"`) when present.
  Render plainly as a link — no iframe embedding (preview hosts set their own frame
  policies; out of scope).

### Trends

**`dashboard/trendView.ts` (pure, fully unit-tested):**

```ts
type LoopRunData = { loop: Loop; scores: Score[]; testRuns: TestRun[];
                     bugs: Bug[];  commits: Commit[]; tasks: Task[] };
type TrendPoint = { loopId: string; order: number;
                    metCount: number; scenarioTotal: number;   // scenarios tagged in this loop's tasks
                    avgComposite: number | null;               // mean of latest composite per tagged scenario
                    bugsOpened: number; bugsFixed: number;
                    tokensTotal: number };                     // Σ commit.tokens.total
buildTrend(loops: LoopRunData[], scenarios: Scenario[]): TrendPoint[]  // ascending by loop.order
```

- **Per-loop met:** a scenario counts met *within loop L* iff its latest score in L has
  `composite >= threshold` AND its latest test-run in L has `failed === 0` — the
  existing `scenarioState.ts` rule applied to a loop-scoped event subset. Refactor
  `scenarioState` to expose its core predicate over a provided event set rather than
  duplicating the logic (the current callers keep their behavior — pure refactor with
  existing tests green).
- Only scenarios tagged in the loop's `tasks[].scenarioIds` count toward that loop's
  `scenarioTotal` (a loop is judged on what it attempted).
- `bugsFixed` counts bugs in L with `status === "fixed"`; `bugsOpened` counts all bugs
  in L (they were opened there).

**`useLoopTrend(teamId, slug)` hook:** takes the `useLoops` list, slices to the most
recent 20 by `order`, and fans out per-loop listeners for scores/testRuns/bugs/commits/
tasks using the existing loop-aware hooks' fetchers (including the implicit `main`
loop's project-direct data via the existing `loopArgFor` convention). Loading until all
slices arrive; errors surface like other tab errors.

**`TrendsStrip` component** on `DashboardTab`, under `RollupStrip`: four labeled
sparklines — *Scenarios met* (`metCount/scenarioTotal`), *Avg composite*, *Bugs*
(opened vs fixed, two strokes), *Tokens/loop* — each an inline SVG polyline with
min/max labels and the latest value; hidden entirely when fewer than 2 loops exist
(no trend from one point). Caption: "last N loops".

## Driver skill

Step 3b addition, before the closing summary: **deploy + report the preview** — deploy
however this project deploys (the skill must not assume a stack; for Firebase-hosted
projects the documented recipe is `firebase hosting:channel:deploy <loopId>`), then
`autoloop loop set <loopId> --preview-url <url>`. If the project has no deploy story,
skip and say so in the summary (no fabricated URLs). Plugin bump; sync skill copies.

## Testing

- **API:** `previewUrl` stored, cleared via `null`, invalid URL 400, absent key when
  omitted (byte-stable).
- **CLI:** `loop set --preview-url` body; empty-string ⇒ `null` clear.
- **Web:** `trendView` — per-loop met logic (incl. loop-scoped latest-event selection
  by id), tagged-scenario totals, token summation with missing `tokens`, ascending
  order; `scenarioState` refactor keeps existing snapshots green; `TrendsStrip` renders
  4 sparklines, hides under 2 loops, labels the 20-loop window; preview link renders
  with `rel="noopener noreferrer"` and absent when no URL.

## Back-compat

Additive field + web-only features. Loops without `previewUrl` and projects with 0–1
loops render exactly as today.

## Out of scope

- Screenshots / visual evidence on test-runs (needs Firebase Storage; future spec).
- Embedding previews in an iframe; preview lifecycle management (expiry is the deploy
  host's concern).
- Cost-in-dollars conversion (token counts only; pricing tables change).
- Per-loop met **history** server-side (derivation stays client-side; revisit only if
  the 20-loop fan-out becomes a measured problem).

## Success criteria

- A loop can report a preview URL; the dashboard and Loops tab link to it prominently.
- With ≥2 loops, the Dashboard shows the four trend sparklines derived per the rules
  above, capped and labeled at 20 loops.
- All suites green; three CLI copies + skill copies synced; no rules change.
