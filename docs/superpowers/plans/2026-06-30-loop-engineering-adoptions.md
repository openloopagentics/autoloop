# Loop-Engineering adoptions for Autoloop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Autoloop's self-scoring loop by adopting six battle-tested ideas from
the `loop-engineering` repo (analysed in `docs/loop-engineering-analysis.md`): a
proven-activity gate, a REJECT-by-default verifier pass, a governance block in
`vision.json`, test-harness detection, allowlist-guarded file reads, and a structured
run-log with budget thresholds.

**Architecture:** Three kinds of change, all additive and backward-compatible:
1. **Schema** — extend `cli/vision-schema.mjs` (the validator) with an optional,
   defaulted governance block; partial visions stay valid (the validator already
   treats missing arrays as empty).
2. **CLI** — add verbs / hardening to `cli/autoloop.mjs` (switch-dispatch on
   `dispatchKey` at line ~679). New verbs follow the existing `cmd sub` convention.
3. **Skills (prose)** — teach `plugins/autoloop/skills/autoloop/SKILL.md` (driver) and
   `plugins/autoloop/skills/autoloop-vision/SKILL.md` (author) to produce and honor the
   new fields, the verifier pass, and the run-log.

**Bundled-copy rule (critical):** `cli/vision-schema.mjs` and `cli/autoloop.mjs` are
each duplicated into the curl-installer / plugin trees. After editing the canonical
`cli/` copies, re-sync the others via `scripts/sync-autoloop-cli.sh` and verify these
stay byte-identical:
- `cli/vision-schema.mjs` → `plugins/autoloop/bin/vision-schema.mjs`, `web/public/skill/vision-schema.mjs`
- `cli/autoloop.mjs` → `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs`
Skills are likewise mirrored under `web/public/skill/autoloop*` — sync those too.

**Tech Stack:** Dependency-free Node ESM (`cli/*.mjs`); Vitest-style tests under
`functions/test/`; markdown skill files; `scripts/sync-autoloop-cli.sh`.

**Reference:** `docs/loop-engineering-analysis.md` (full source-level analysis + the
ranked-lessons list this plan implements).

**Conventions:**
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- The `daloop-42b47` project id/URL is immutable — do not touch it.
- Bump the plugin version once at the end of the batch; deploy the batch together.
- Every `autoloop …` command added to a skill must be valid against `cli/autoloop.mjs`,
  and `functions/test/` suites must stay green.

**Correctness bar:** existing vision.json files validate unchanged; the new fields are
optional with safe defaults; every bundled copy is byte-identical to its canonical
source; new behavior is covered by a test.

---

## Phasing & dependencies

- **Phase A (foundation):** Task 1 (governance schema) → Task 2 (test-harness signal).
  Everything else reads these.
- **Phase B (verification core):** Task 3 (verifier pass) → Task 4 (proven-activity
  gate). Task 4 depends on Task 2 + Task 3.
- **Phase C (ops & hardening):** Task 5 (structured run-log + budget) depends on Task 1;
  Task 6 (allowlist file-read hardening) is independent and may run in parallel.
- **Phase D:** Task 7 (sync + version bump + full verification).

```
Task1 ─┬─> Task4 ──> Task5
Task2 ─┘            (Task6 ‖ independent)
Task3 ─> Task4
all ──> Task7
```

---

### Task 1 — Add an optional `governance` block to the vision schema (Lesson 3)

**Files:**
- Edit: `cli/vision-schema.mjs` (canonical validator)
- Edit: `plugins/autoloop/skills/autoloop-vision/SKILL.md` (interview + documented shape)
- Add test cases: `functions/test/vision-schema.test.ts`

Extend `validateVision` to accept an **optional** `governance` object, at the top level
and/or per scenario (`scenario.governance` overrides loop-level). All fields optional
with defaults; absence is valid (mirrors how `goals`/`scenarios` default to empty).

Shape:
```jsonc
"governance": {
  "autonomy": "L2",              // enum L1|L2|L3, default L1
  "dailyTokenCap": 500000,       // integer >= 10000 (matches loop-engineering floor)
  "earlyExit": true,             // boolean, default false
  "humanGates": ["payments", "auth", ">10-files", "3rd-attempt"]  // string[], each non-empty
}
```

- [ ] **Step 1:** In `cli/vision-schema.mjs`, add a `validateGovernance(g, at)` helper
  pushing errors: `autonomy` must be one of `L1|L2|L3`; `dailyTokenCap` must be an
  integer ≥ 10000; `earlyExit` must be boolean; `humanGates` must be an array of
  non-empty strings. Call it for `v.governance` (if present) and each
  `scenarios[i].governance` (if present). Keep "missing is valid."
- [ ] **Step 2:** Update the `## Output: vision.json` shape block and the interview
  steps in `autoloop-vision/SKILL.md` to (a) document the governance block, (b) ask the
  user for autonomy level + cap + human gates as an optional final interview step, and
  (c) note that the loop honors them. Reuse the loop-engineering defaults table from
  `docs/loop-engineering-analysis.md` §D as suggested caps.
- [ ] **Step 3 (verify):** add tests — a vision with no governance is valid; valid
  governance passes; bad autonomy / sub-floor cap / non-boolean earlyExit / empty gate
  each produce the exact error string. Run the suite.

---

### Task 2 — Test-harness detection signal (Lesson 4)

**Files:**
- Edit: `cli/vision-schema.mjs` (emit a non-fatal `warnings[]` channel) OR
  `cli/autoloop.mjs` (preflight) — see Step 1 decision.
- Edit: `plugins/autoloop/skills/autoloop/SKILL.md` (Step 0 preflight)
- Add test: `functions/test/vision-schema.test.ts`

Goal: a scenario whose rubric implies behavior but has **no runnable `test.command`**
should be surfaced loudly, because "done" is otherwise subjective (goal-audit's
"No test harness — done conditions are subjective").

- [ ] **Step 1:** Decide the channel. Preferred: add an optional `warnings: []` to the
  validator's return (`{ ok, errors, warnings }`) so callers stay backward-compatible
  (`ok` unaffected). Emit a warning per scenario missing `test.command`.
- [ ] **Step 2:** In `autoloop/SKILL.md` Step 0 (Resume check / preflight), add: before
  driving, detect a project test harness (presence of `package.json` test script,
  `pyproject.toml`/`pytest.ini`, `go.mod`, `Cargo.toml`, or a `test/` dir) and list
  scenarios lacking `test.command`. If a scenario has no test path, the loop may still
  run but must mark that scenario's score as **unverified** (feeds Task 4).
- [ ] **Step 3 (verify):** test that warnings list the right scenarios; `ok` is still
  true. Run the suite.

---

### Task 3 — REJECT-by-default verifier pass (Lesson 2)

**Files:**
- Edit: `plugins/autoloop/skills/autoloop/SKILL.md` (insert verifier sub-step)
- Add: `plugins/autoloop/skills/autoloop/loop-verifier.md` (bundled verifier brief)
- Mirror the new file under `web/public/skill/autoloop/` in Task 7.

Adopt `loop-verifier`'s discipline as a distinct pass between implementation and
scoring. The implementer subagent must **not** mark its own work done. Per the IEEE
piece's "self-praise" finding, the verifier must **assume the code is broken** and
validate by **observing the running artifact's behavior** — run it / inspect output /
inspect the DOM — not merely confirm a green test or read the diff.

- [ ] **Step 1:** Author `loop-verifier.md` — port the 5-item checklist (scope, intent,
  tests, no-cheating, risk) and the verbatim rules: *"Default stance: REJECT until
  proven otherwise. Assume the code is broken. Do not trust the implementer's claim
  that tests passed — run them, and observe the artifact's actual runtime behavior."
  If you cannot run/observe → ESCALATE_HUMAN."* Verdict: APPROVE | REJECT |
  ESCALATE_HUMAN, with an Evidence block (test command + output snippet **and** a
  runtime-behavior observation: what was run, what was seen).
- [ ] **Step 2:** In `autoloop/SKILL.md`, after the implementation subagent and before
  the score step, dispatch an **independent verifier subagent** (fresh role; different
  model where available) that reads `loop-verifier.md`, runs the scenario's
  `test.command`, **observes the running artifact** (executes it / inspects output or
  the DOM for the scenario's acceptance behavior), and returns the verdict. Only APPROVE
  proceeds to scoring; REJECT loops back to the implementer (subject to the attempt
  cap); ESCALATE_HUMAN pauses and reports.
- [ ] **Step 3:** Add a hard **attempt cap of 3** per scenario (loop-engineering's
  Infinite-Fix-Loop mitigation): on the 3rd REJECT, escalate to the user and move on.
- [ ] **Step 4 (verify):** dry-read the skill — every `autoloop …` command is valid
  against `cli/autoloop.mjs`; the verifier step references real CLI verbs only.

---

### Task 4 — Proven-activity gate on scoring (Lesson 1)

**Files:**
- Edit: `cli/autoloop.mjs` (the `score` verb — require evidence)
- Edit: `plugins/autoloop/skills/autoloop/SKILL.md` (scoring rules)
- Add test: `functions/test/` (score-evidence validation)

A scenario may only be marked **met/advanced** when all three hold: (a) the verifier
APPROVED (Task 3), (b) a real `test.command` executed (Task 2), and (c) the run is
logged (Task 5). Score alone never advances a scenario — this is the core anti-
"grading your own homework" change, mirroring loop-audit's L3 cap.

- [ ] **Step 1:** Extend the `score` CLI verb to accept/record an evidence triplet
  (e.g. `--verifier approved|rejected|escalated`, `--test-ran`, and it already has the
  numeric score). Reject (exit non-zero) an attempt to mark a scenario `met` without
  `--verifier approved` and `--test-ran`, **unless** the scenario was flagged
  unverified by Task 2 and autonomy is L1 (report-only) — in which case record it as
  `reported`, not `met`.
- [ ] **Step 2:** In `autoloop/SKILL.md`, rewrite the Evaluate/score step so the
  "met-rule" requires the evidence triplet; document that an unverified scenario at L2+
  cannot be marked met and must escalate.
- [ ] **Step 3:** Honor `governance.autonomy` from Task 1: L1 = report-only (never
  auto-advance), L2 = advance on verifier-approval + tests, L3 = same but allowed to
  continue unattended past a phase boundary.
- [ ] **Step 4 (verify):** test that `score … --status met` without evidence exits
  non-zero; with full evidence succeeds. Run the suite.

---

### Task 5 — Structured run-log + budget thresholds (Lesson 6)

**Files:**
- Edit: `cli/autoloop.mjs` (new `run-log append` verb + local file)
- Edit: `plugins/autoloop/skills/autoloop/SKILL.md` (call it each iteration)

Adopt `loop-budget`'s append-only run-log and threshold behavior locally (complements
the existing dashboard reporting; this is the on-disk spine).

- [ ] **Step 1:** Add an `autoloop run-log append` verb that appends one JSON object per
  iteration to `loop-run-log.md` (or `.autoloop-runlog.jsonl`) with fields: `run_id`
  (ISO8601), `scenario`, `task`, `duration_s`, `actions_taken`, `escalations`,
  `tokens_estimate`, `outcome` (`no-op | reported | met | rejected | escalated`).
- [ ] **Step 2:** In `autoloop/SKILL.md`, at the end of every iteration append a run-log
  entry. At the start, read `governance.dailyTokenCap` (Task 1): at ≥80% spend →
  report-only mode (no further implementation subagents this period); at ≥100% → pause
  the loop and report. If `governance.earlyExit` and there is no actionable task → exit
  cheaply rather than spawning subagents.
- [ ] **Step 3 (verify):** unit-test the append verb produces valid JSONL with the
  required keys; manually confirm the skill's threshold prose references real fields.

---

### Task 6 — Allowlist-guard caller-supplied file paths (Lesson 5)

**Files:**
- Edit: `cli/autoloop.mjs` (every verb taking `--file` / `--url` — e.g. `vision import`,
  `test-run --summary --file`, document import)
- Add test: `functions/test/` (path-guard cases)

Port `mcp-server`'s `assertSafeSegment` defense-in-depth so a caller-supplied path can't
traverse outside the loop working dir.

- [ ] **Step 1:** Add a small `assertSafePath(p)` helper that resolves `p` against the
  cwd and rejects paths containing `..` segments, null bytes, or that resolve outside
  the working directory; reject absolute paths unless explicitly allowed.
- [ ] **Step 2:** Apply it at every `--file`/`--url` read site in `cli/autoloop.mjs`.
  Keep error messages actionable (`Invalid --file: <p>`), exit non-zero.
- [ ] **Step 3 (verify):** test that `../../etc/passwd`, an absolute path, and a
  null-byte path are all rejected; a normal in-dir path is accepted. Run the suite.

---

### Task 7 — Sync bundled copies, bump version, full verification

**Files:**
- Run: `scripts/sync-autoloop-cli.sh`
- Edit: plugin manifest version (single bump for the batch)
- Verify: all four bundled-copy pairs + the mirrored skills

- [ ] **Step 1:** Run `scripts/sync-autoloop-cli.sh`; confirm `cli/vision-schema.mjs`
  and `cli/autoloop.mjs` are byte-identical to their `plugins/autoloop/bin/*` and
  `web/public/skill/*` copies (`diff` each pair). Mirror the new
  `loop-verifier.md` and edited skills into `web/public/skill/autoloop*`.
- [ ] **Step 2:** Bump the plugin version once.
- [ ] **Step 3 (verify):** run the full `functions/test/` suite green; run
  `node cli/vision-schema.mjs <an existing vision.json>` to confirm backward
  compatibility; smoke-test the new CLI verbs (`run-log append`, `score` evidence guard,
  `assertSafePath`). Do NOT deploy here — the batch deploys together per repo convention.

---

### Task 8 (deferred / optional) — Convergence/drift monitor for the revision loop (Lesson 7)

**Files:**
- Edit (cheap version): `plugins/autoloop/skills/autoloop/loop-verifier.md` + the
  Evaluate step in `autoloop/SKILL.md`

When a scenario is reworked across attempts, detect whether the loop is **settling
down** (converging — keep going), **circling** (flip-flopping between two versions —
escalate), or **drifting** (each version further from the scenario goal — escalate for
scope drift). This is a cross-iteration signal that complements Task 3/4's per-iteration
checks, and a smarter escalation trigger than Task 3's fixed 3-attempt counter.

- [ ] **Step 1 (cheap, near-term):** Add to the verifier brief a per-revision judgment:
  compare this attempt to the previous attempt and to the scenario goal, and classify
  `closer | circling | drifting`. In `autoloop/SKILL.md`, escalate on `circling` or
  `drifting` **before** the attempt cap is reached. No new infrastructure.
- [ ] **Step 2 (deferred, research-grade):** Replace the qualitative judgment with
  embedding-based drift metrics (local drift between attempts, global drift vs. the
  scenario-goal embedding) to classify the regime numerically. Requires adding an
  embedding pipeline — out of scope for this batch; revisit as a standalone spike.

> Caveat: the source (arXiv 2512.10350) is a lightly-validated single-author preprint.
> Adopt the cheap version as a useful heuristic; gate the rich version behind its own
> evaluation.

---

## Out of scope / deferred
- A full `loop-audit`-style readiness scorer for arbitrary repos (Autoloop already owns
  its own state; revisit if we ship Autoloop as a general framework).
- The MCP server surface (Lesson 5 here is only the path-guard primitive, not a server).
- Dollar-cost conversion (loop-cost is token-only; we mirror that).
