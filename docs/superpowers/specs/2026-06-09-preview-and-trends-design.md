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

`loops.ts` service: `if (body.previewUrl !== undefined) data.previewUrl =
body.previewUrl;` — i.e. **`null` is stored** (the web treats `null` and absent alike
and hides the link), which is exactly how `commits.ts` handles `commit.url`; we do
NOT use `FieldValue.delete()`. Omitting the field keeps the stored doc byte-stable.
CLI: `autoloop loop set <id> --preview-url <url>` (and `--preview-url ""` sends
`null` to clear). Note: `loop set` currently hard-requires `--status`
(`UsageError` in the CLI) — relax to "at least one settable flag", preserving the
existing terminal-status side effect (clearing `cfg.currentLoopId`) untouched. Sync
the three CLI copies.

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
                     bugs: Bug[];  taskCommits: Commit[]; tasks: Task[] };
type TrendPoint = { loopId: string; order: number;
                    metCount: number; scenarioTotal: number;   // scenarios tagged in this loop's tasks
                    avgComposite: number | null;               // mean of latest composite per tagged scenario
                    bugsOpened: number; bugsFixed: number;
                    tokensTotal: number };                     // Σ taskCommit.tokens.total
buildTrend(loops: LoopRunData[], scenarios: Scenario[]): TrendPoint[]  // ascending by loop.order
```

- **Per-loop met:** a scenario counts met *within loop L* iff its latest score in L has
  `composite >= threshold` AND its latest test-run in L has `failed === 0`. No
  refactor needed: `deriveScenarioState(scenario, scores, testRuns)` in
  `scenarioState.ts` is already a pure predicate over whichever event arrays it is
  given — `trendView` simply calls it with loop-scoped subsets.
- Only scenarios tagged in the loop's `tasks[].scenarioIds` count toward that loop's
  `scenarioTotal` (a loop is judged on what it attempted).
- `bugsFixed` counts bugs in L with `status === "fixed"`; `bugsOpened` counts all bugs
  in L (they were opened there).
- **`tokensTotal` comes from task commits only.** Commits are nested
  (`tasks/{taskId}/commits`), and only the task-commit service persists
  `commit.tokens` — the legacy phase-commit path never stores tokens, and the CLI
  attributes subagent usage exclusively through task commits. So
  `tokensTotal = Σ tokens.total` over the loop's task commits (missing `tokens` ⇒ 0).

**`useLoopTrend(teamId, slug)` hook:** takes the `useLoops` list, slices to the most
recent 20 by `order`, and fans out per-loop **listeners** for the four flat
collections — scores/testRuns/bugs/tasks — reusing the per-scope accumulator pattern
of the existing `useAllScores`/`useAllTestRuns`/`useAllBugs` hooks (`byScope` map +
stale-scope filtering; those hooks are today *unbounded* across loops, so a 20-capped
fan-out is more conservative than existing code). Task **commits** (the nested level)
are fetched with **one-shot `getDocs` reads** keyed on each loop's tasks snapshot —
not listeners — bounding listener count at 20 × 4 and accepting that token totals
refresh on tasks changes rather than live-ticking (trends don't need realtime token
movement). The implicit `main` loop's project-direct data participates via the
existing `loopArgFor` convention and orders **first** (oldest — it predates loop-level
adoption; `buildLoopList` synthesizes it without an `order`). Loading until all slices
arrive; errors surface like other tab errors.

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

- **API:** `previewUrl` stored, `null` stored on clear, invalid URL 400, absent key
  when omitted (byte-stable).
- **CLI:** `loop set --preview-url` body; empty-string ⇒ `null` clear; `loop set`
  without `--status` no longer errors (and terminal-status side effects unchanged).
- **Web:** `trendView` — per-loop met via `deriveScenarioState` over loop-scoped
  subsets (incl. latest-event selection by id), tagged-scenario totals, token
  summation over task commits with missing `tokens`, `main` ordered first then
  ascending `order`; `TrendsStrip` renders 4 sparklines, hides under 2 loops, labels
  the 20-loop window; preview link renders with `rel="noopener noreferrer"`, hidden
  when no URL or `null`.

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
