# Loop Engineering — code-level analysis & lessons for Autoloop

> Source: <https://github.com/cobusgreyling/loop-engineering> (Cobus Greyling).
> Reviewed at the source level — every tool's `src/*.ts`, the registry schema, and
> the runtime skills — on 2026-06-30. This doc is the reference; the companion
> implementation plan is `docs/superpowers/plans/2026-06-30-loop-engineering-adoptions.md`.

## What it is

A framework for **orchestrating coding agents in scheduled, self-governing loops**
rather than hand-prompting them. Premise (Boris Cherny, quoted in the repo):
*"I don't prompt Claude anymore. I have loops running that prompt Claude."* It ships
7 production loop patterns (PR babysitter, CI sweeper, dependency sweeper, daily/issue
triage, post-merge cleanup, changelog drafter), 6 real CLI tools, a machine-readable
governance registry, and 4 runtime skills. It is directly adjacent to Autoloop — the
difference is that its patterns are **ops/maintenance** loops, whereas Autoloop is a
**vision-driven feature-building** loop. The transferable assets are the governance
schema, the verification discipline, and the cost/safety machinery.

## Conceptual framing (from the IEEE positioning write-up)

A companion conceptual piece (<https://hyper.ai/en/papers/Loop-Engineering-IEEE>)
adds framing the repo itself doesn't make explicit. (Note: it is positioning, not a
formal paper — no equations, metrics, or theorems.)

**The four-layer stack.** Loop engineering is the **fourth layer**:
`prompt → context → harness → loop`. The first three layers all keep the human *doing*
the work; loop engineering *"removes the practitioner from the position of doing the
work at all."* **Autoloop is a layer-4 system** — this is the vocabulary for what it is.

**Five moves × six parts.** The repo's six *structural parts* (Automations, Worktrees,
Skills, Connectors, Sub-agents, Memory — the nouns) are orthogonal to the **five moves
every iteration must perform** (the verbs). Use the five moves as a **per-iteration
audit checklist**:

| Move | What it does | Autoloop status |
|---|---|---|
| Discovery | find the next unit of work | strong (task plan from vision) |
| Handoff | isolate work (worktrees) | strong (subagent + worktree) |
| **Verification** | critically evaluate output | **weakest — self-score** (Lessons 1+2) |
| Persistence | save state across context windows | server state; run-log = Lesson 6 |
| Scheduling | trigger the next iteration | strong (the driver loop) |

Running this lens against Autoloop independently lands on the same gap this analysis
prioritizes: **Verification** is the soft move, which Lessons 1 and 2 target.

**"Self-praise" finding.** The piece states *"agents grading their own output tend to
self-praise,"* and prescribes the Evaluator be *"instructed to assume the code is
broken"* and validate by *"running tests or inspecting the DOM rather than just reading
code"* — i.e. **observe the running artifact's behavior, not just a green test or the
diff.** This is a stronger bar than "run the test command" and sharpens Lesson 2.

Its "four hidden costs" (Verification debt, Comprehension rot, Cognitive surrender,
Token blowout) map ~1:1 onto the repo failure modes in §E — same concepts, crisper names.

---

## A. The six shipping tools (published TypeScript)

### 1. `loop-audit` — Loop Readiness Score (0–100, levels L0–L3)
Heuristic file/structure detector plus a light git scan. Never executes anything.
- **~21 weighted signals.** Base 10; e.g. state file +18, triage skill +14, verifier
  +14, ≥2 skills +14, AGENTS.md +9, LOOP.md +9, GitHub workflows +6/+4, safety docs
  +4/+4, worktree evidence +3, registry +2, budget doc/run-log +3/+3, **proven loop
  activity +6**.
- **Detects real usage, not just files**: scans state files for `Last run` lines,
  greps `git log --oneline -25` for loop/triage/changelog commits, looks for scheduled
  workflows.
- **L3 is gated beyond score**: even at score ≥78 it caps at L2 unless there is
  (a) verifier + state file, (b) **cost observability** (budget doc + run-log + LOOP.md
  budget), AND (c) **proven activity**. Two explicit "capped at L2 because…" warnings.
- Output: human / `--json` / `--md` / `--badge` (shields.io). Exit 0 if ≥40, else 2.

### 2. `goal-audit` — Goal Readiness Score (0–100, levels G0–G3)
Flat additive sibling for Grok `/goal` workflows. Verifier weighted heaviest (+20),
tests +15, CI +10. Notable: **detects a real test harness** (`package.json`,
`pyproject.toml`, `go.mod`, `Cargo.toml`, vitest/jest/pytest configs, `tests/` dirs)
and CI — and warns "No test harness — done conditions are subjective."

### 3. `loop-cost` — token-spend estimator (no dollars)
- **Cadence → runs/day**: `floor(86_400_000ms / interval_ms)`. A range `5m-15m` with
  `--conservative` picks the slower end (fewer runs/day).
- **Realistic blend by level** over three scenarios (no-op / report / action):
  L1+early-exit = 90/10/0, L2 = 85/10/5, L3 = 40/35/25 ("unattended — monitor closely").
  `realistic_per_run = Σ(tokens × weight)`, ×runs/day.
- **Four auto-warnings**: early-exit-required, worst-case > cap, realistic > cap,
  and `runsPerDay ≥ 96` → "verify early-exit is working."

### 4. `loop-init` — scaffolder
Copies a starter (skills, agents, state file, LOOP.md) for a pattern × tool
(grok/claude/codex), writes observability files (`loop-budget.md` from a per-pattern
budget table, `loop-run-log.md`, loop-budget skill), optionally AGENTS.md, then
**shells out to `loop-audit --json`** and prints the score + a "first loop"
slash-command. Idempotent. `maxSpawnsL1` is always 0 — no sub-agents at L1 by design.

### 5. `loop-sync` — drift detector (read-only)
Scores config consistency 0–100 (−20/error, −10/warning, −1/info). Checks required
files, STATE↔LOOP cross-refs, skill versions. **Known bugs (do not copy):** `--json`
parsed but dropped before use; `--auto-fix`/`--dry-run` accepted but nothing is ever
written; code level thresholds contradict its own README.

### 6. `mcp-server` (`@cobusgreyling/loop-mcp-server`) — read-only MCP over stdio
- **5 static resources**: `loop://registry`, `loop://config`, `loop://budget`,
  `loop://run-log`, `loop://safety`.
- **3 dynamic templates**: `loop://patterns/{id}`, `loop://skills/{name}`,
  `loop://state/{file}`.
- **8 tools**: list/get patterns, skills, state; `loop_recommend_pattern`
  (keyword-scored); `loop_estimate_cost`.
- **Security model worth copying**: `assertSafeSegment` rejects `..`, `/`, `\`, null
  bytes; pattern/state reads go through **allowlists** (`STATE_FILE_CANDIDATES`,
  registry-derived ids). Defense-in-depth for an agent-facing file reader.

---

## B. The governance schema (`registry.schema.json`) — the most reusable artifact

JSON Schema 2020-12. Each pattern **must** declare: `id`, `name`, `file`, `goal`,
`cadence` (regex `^[0-9]+[mhd](-[0-9]+[mhd])?$`), `risk` (low/med/high), `tools`,
`skills`, `state`, `phases` (≥2), `human_gates` (≥1). Optional: `starter`,
`week_one_mode` (L1/L2/L3), `token_cost`, and a `cost` block requiring
`tokens_noop`, `tokens_report`, `tokens_action`, `suggested_daily_cap`,
`early_exit_required`. The `phases` + `human_gates` + `cost` triplet is exactly the
governance metadata `vision.json` lacks today.

---

## C. The four runtime skills (behavioral core)

- **`loop-verifier`** — REJECT-by-default checker. *"Your job is to reject unless
  evidence is strong… Do not trust implementer's claim that tests passed — run them…
  If you cannot run tests → ESCALATE_HUMAN."* 5-item checklist (scope/intent/tests/
  no-cheating/risk); verdict APPROVE | REJECT | ESCALATE_HUMAN.
- **`minimal-fix`** — smallest-diff maker. One problem per invocation, denylist-aware,
  *"Do not mark your own work done — the verifier decides."*
- **`loop-triage`** — structured triage (High-priority / Watch / Noise / State-updates),
  *"signal, not invention — never propose architectural overhauls during triage."*
- **`loop-budget`** — runs start+end of every iteration: ≥80% cap → report-only,
  ≥100% or `loop-pause-all` → exit, empty watchlist → exit in <5k tokens; appends a
  structured JSON run-log entry (`outcome: no-op | report-only | fix-proposed | escalated`).

---

## D. The 7 patterns + cost constants

| id | cadence | token_cost | daily cap | early-exit |
|---|---|---|---|---|
| pr-babysitter | 5m-15m | high | 2,000,000 | yes |
| ci-sweeper | 5m-15m | very-high | 1,000,000 | yes |
| dependency-sweeper | 6h-1d | medium | 500,000 | yes |
| post-merge-cleanup | 1d-6h | low | 200,000 | no |
| daily-triage | 1d-2h | low | 100,000 | no |
| changelog-drafter | 1d | low | 100,000 | no |
| issue-triage | 2h-1d | low | 80,000 | no |

Each declares `phases` and `human_gates` (e.g. dependency-sweeper gates:
`major-bumps, high-sev-cve, denylisted-packages, max-attempts`).

---

## E. Also in the repo

16 docs (`failure-modes`, `anti-patterns`, `loop-design-checklist`, `safety`,
`multi-loop`, `pattern-picker`, `primitives-matrix`), 10 **stories** (postmortems incl.
`why-we-killed-ci-sweeper.md`, `multi-loop-collision.md`, `l1-to-l2-graduation.md`),
example sets per tool ecosystem, starter kits, and templates.

### Reusable safety primitives (from `docs/safety.md`)
Denylist globs never to auto-edit:
```
.env, .env.*, **/secrets/**, **/credentials/**, **/*_key*, **/*_secret*,
.terraform/**, k8s/production/**, **/migrations/**, auth/**, payments/**, billing/**
```
Mandatory human gates: security/authz, payments/PII, infra, dependency upgrades,
**any change touching >10 files**, **3rd failed attempt on same task**.

### Failure modes most relevant to a self-scoring loop
- **Verifier Theater** — verifier approves but CI fails → checker must run the real
  test/lint command and report output; use a different model than the maker.
- **Infinite Fix Loop** — hard cap (e.g. 3) → escalate; track attempt count in state.
- **State Rot** — prune closed/merged items each run; validate IDs against live API.
- **Comprehension Debt Spiral** — velocity up, changes unexplainable, review becomes
  rubber-stamp.

---

## Ranked lessons for Autoloop (drives the implementation plan)

1. **Proven-activity gate** (from `loop-audit`). A high self-score must not earn a
   "met"/advanced verdict on its own — require that (a) a verifier ran, (b) a real
   test command executed, and (c) the run was logged. Antidote to a self-scoring loop
   grading its own homework (the "self-praise" finding).
2. **REJECT-by-default verifier as a separate self-score pass** — independent role,
   defaults to reject, assumes the code is broken, and validates by **observing the
   running artifact's behavior** (run it / inspect output / inspect the DOM), not just
   confirming green tests or reading the diff. Highest-leverage single change.
3. **Governance block in `vision.json`** — per-scenario/loop `dailyTokenCap`,
   `earlyExit`, `autonomy` (L1/L2/L3), `humanGates`. Declarative cost/safety instead
   of prose.
4. **Test-harness detection / fail-loud-if-no-tests** — a scenario whose rubric
   implies behavior must have a runnable `test.command`, or be flagged; "done" is
   otherwise subjective.
5. **Read-only access with allowlists** — wherever Autoloop reads caller-supplied file
   paths (`--file` args), adopt `assertSafeSegment` + allowlist/segment guards.
6. **Structured run-log (loop-budget style)** — append-only per-iteration JSON
   (`run_id`, scenario, duration, actions, escalations, tokens_estimate, `outcome`
   enum) plus 80%/100% budget thresholds and empty-watchlist early-exit.
7. **Convergence/drift monitor** (from the arXiv "Geometric Dynamics of Agentic Loops"
   paper, 2512.10350 — a formal but lightly-validated single-author preprint; treat as
   inspiration, not gospel). When Autoloop reworks the same scenario over and over, the
   revision loop is doing one of three things: **settling down** (each version close to
   the last, getting better — good), **circling** (flip-flopping between two versions,
   never finishing — a stuck loop), or **drifting** (wandering further from the original
   goal each time — scope drift). The paper's point is you can *detect which* by tracking
   how much each version differs from the previous one and from the original goal — and
   stop early when it's circling or drifting, instead of blindly burning a fixed attempt
   count. This is a **cross-iteration** signal, complementary to the per-iteration checks
   in Lessons 1–2.
   - **Cheap version (feasible now):** have the verifier judge, each revision, "closer /
     circling / drifting from the scenario goal?" qualitatively, and escalate on
     circling or drift. No new infrastructure.
   - **Rich version (deferred / research-grade):** compute embedding-based drift metrics
     per iteration to classify the regime numerically. Needs an embedding pipeline
     Autoloop doesn't have today.
