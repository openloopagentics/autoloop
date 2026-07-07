# Loop survives compaction (never stop unless the user stops it) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Autoloop `/autoloop` driver survive Claude Code context compaction (and premature turn-ends) so a loop never stops unless the user stops it — via two new hooks (`SessionStart` re-injects resume intent; `Stop` blocks turn-end while the loop is live, bounded by an idle guard) plus SKILL wording.

**Architecture:** Pure decision/derivation helpers (`decideStop`, `stopFingerprint`, `hasPendingStop`, `sessionStartContext`) carry the logic and are unit-tested; thin `hook session-start` / `hook stop` dispatch cases wire them to `fetchResumeState` + a small `.stop.json` idle-state file and emit the control JSON. `installRelaunch` registers the two hooks the same way it already registers `SessionEnd`.

**Tech Stack:** Node ESM CLI (`cli/autoloop.mjs`, dependency-free), Vitest unit tests in `functions/test/cli.unit.test.ts`, the driver skill in `plugins/autoloop/skills/autoloop/SKILL.md`.

**Spec:** `docs/superpowers/specs/2026-06-30-loop-survives-compaction-design.md`
**Branch:** `loop-survives-compaction` (off main; spec already committed). CLI/plugin only — no backend/web.

**Critical conventions (from code recon):**
- Hooks are **best-effort: always `return 0`**; a throwing hook must never break Claude Code or block compaction.
- **New stdout pattern:** unlike the existing `hook session-end`/`hook wake` (exit-0 + side effects, no stdout), the two new hooks emit a single control-JSON line to **stdout** via `log(JSON.stringify(out))`. All diagnostics go to the file logger `hookLog(...)` (NOT stdout) so stdout carries only the hook output.
- Pure helpers are `export`ed and added to the test import on `functions/test/cli.unit.test.ts:6` — add `stopFingerprint`, `decideStop`, `STOP_IDLE_MAX`, `hasPendingStop`, `sessionStartContext`, and `stopPath` there as each task introduces it. Test with plain `expect(fn(...)).toBe(...)` (no mocks) — mirror the existing `decideWake` test at `:1134`.
- Handler tests use the existing `run([...], { cwd, env, fetchImpl, log, err })` harness with `env.HOME` pointed at a temp dir (so `~/.autoloop` is sandboxed) and an injected `fetchImpl` returning a state bundle; `readHookStdin()` returns `null` under vitest (no piped stdin), so handlers fall back to `cwd`.
- Run/sync: `cd functions && npm run test:run -- cli.unit`; after editing the CLI, `bash scripts/sync-autoloop-cli.sh`.
- Use @superpowers:test-driven-development per task.

---

## File Structure

| File | Change |
|---|---|
| `plugins/autoloop/skills/autoloop/SKILL.md` | reword: compaction is no longer a stop; add "Surviving compaction" note |
| `cli/autoloop.mjs` | new exports `STOP_IDLE_MAX`, `stopFingerprint`, `decideStop`, `hasPendingStop`, `sessionStartContext`, `stopPath`; new `case "hook session-start"` + `case "hook stop"`; extend `installRelaunch` (register + dedupe the two hooks; uninstall removes them) |
| `functions/test/cli.unit.test.ts` | unit tests for the pure helpers + the two handlers + the installer hooks |
| `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs`, `web/public/skill/autoloop/SKILL.md` | re-synced via `scripts/sync-autoloop-cli.sh` |

---

## Task 1: SKILL.md — compaction is no longer a stop

**Files:** Modify `plugins/autoloop/skills/autoloop/SKILL.md` (no automated test; doc change).

- [ ] **Step 1: Remove context-exhaustion as a stop — both occurrences.**
  - In the valid-stop list (~line 347-353), **delete item 3** ("Genuine context or token exhaustion — you physically cannot continue.") and leave items 1–2 (re-numbered).
  - In the Rules line (~line 454), change *"…unless the user explicitly said to, gave a round count you've hit, **or you've hit genuine context exhaustion**."* → drop the "or you've hit genuine context exhaustion" clause.

- [ ] **Step 2: Add a "Surviving compaction" note** right after the Step 0 resume section (~line 65), matching the surrounding voice:
  > **Surviving compaction.** If your context is compacted/summarized mid-loop — you'll notice lost detail, or a `SessionStart` hook will inject a short "loop mid-flight — resume" note — do NOT treat it as done or as a stop. Immediately re-run `autoloop loop resume`, rebuild the next task from `state`, and continue the Step 2 loop. A `Stop` hook keeps the loop alive across turn-ends, so if you end a turn with work remaining you'll be prompted to continue; the only real stops are a user `stop`/`pause` message, a hit iteration count, or a terminal loop.

- [ ] **Step 3: Sync + commit.**
```bash
bash scripts/sync-autoloop-cli.sh   # re-copies the bundled SKILL to the curl installer
git add plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md
git commit -m "docs(skill): compaction is not a stop — resume and continue"
```

---

## Task 2: `stopFingerprint(state)` — progress signal

**Files:** `cli/autoloop.mjs`, `functions/test/cli.unit.test.ts`.

- [ ] **Step 1: Write the failing test** (add inside the existing pure-decision `describe`, near the `decideWake` test; add `stopFingerprint` to the import on line 6):
```ts
it("stopFingerprint changes when the loop advances, stable otherwise", () => {
  const base = {
    loop: { status: "running", currentPhaseId: "p1", currentTaskId: "t1" },
    phases: [{ id: "p1", status: "running" }],
    tasks: [{ id: "t1", status: "running" }, { id: "t2", status: "queued" }],
    openBugs: [{ id: "b1" }],
    scenarios: [{ id: "s1", latestComposite: 70, latestTestRun: { passed: 1, failed: 1 } }],
  };
  const fp = stopFingerprint(base);
  expect(stopFingerprint(structuredClone(base))).toBe(fp);                 // identical → same
  const advanced = structuredClone(base); advanced.tasks[0].status = "completed";
  expect(stopFingerprint(advanced)).not.toBe(fp);                          // task completed → changed
  const scored = structuredClone(base); scored.scenarios[0].latestComposite = 85;
  expect(stopFingerprint(scored)).not.toBe(fp);                            // new score → changed
});
```

- [ ] **Step 2: Run → fails** — `cd functions && npm run test:run -- cli.unit` (stopFingerprint not exported).

- [ ] **Step 3: Implement** (place near `isResumable`):
```js
/** A stable string summarizing loop progress, from the /state bundle (loopState.ts LoopState).
 *  Changes whenever the loop advances (task/phase status, pointer, open bugs, or a scenario's
 *  latest score/test). Pure. Used by the Stop hook's idle guard. */
export function stopFingerprint(state) {
  const loop = state?.loop ?? {};
  const tasks = (state?.tasks ?? []).map((t) => `${t.id}:${t.status ?? ""}`).sort();
  const phases = (state?.phases ?? []).map((p) => `${p.id}:${p.status ?? ""}`).sort();
  const bugs = (state?.openBugs ?? []).map((b) => b.id).sort();
  const scns = (state?.scenarios ?? [])
    .map((s) => `${s.id}:${s.latestComposite ?? ""}:${s.latestTestRun?.passed ?? ""}/${s.latestTestRun?.failed ?? ""}`)
    .sort();
  return JSON.stringify({
    status: loop.status ?? null, phase: loop.currentPhaseId ?? null, task: loop.currentTaskId ?? null,
    tasks, phases, bugs, scns,
  });
}
```

- [ ] **Step 4: Run → pass.** `cd functions && npm run test:run -- cli.unit`.
- [ ] **Step 5: Commit.** `git add cli/autoloop.mjs functions/test/cli.unit.test.ts && git commit -m "feat(cli): stopFingerprint — loop-progress signal for the idle guard"`

---

## Task 3: `decideStop` + `STOP_IDLE_MAX`

**Files:** `cli/autoloop.mjs`, `functions/test/cli.unit.test.ts`.

- [ ] **Step 1: Write the failing test** (mirror the `decideWake` test exactly; add `decideStop` to the import):
```ts
it("decideStop: block while live & progressing/under-cap; allow on terminal/paused/pending-stop/idle-cap", () => {
  const live = { loopStatus: "running", hasPendingStop: false, progressed: true, idleCount: 0, idleMax: 3 };
  expect(decideStop(live).block).toBe(true);                                   // progressing → keep going
  expect(decideStop({ ...live, loopStatus: "completed" }).block).toBe(false);  // terminal → allow
  expect(decideStop({ ...live, loopStatus: undefined }).block).toBe(false);    // no loop → allow
  expect(decideStop({ ...live, loopStatus: "paused" }).block).toBe(false);     // paused → allow
  expect(decideStop({ ...live, hasPendingStop: true }).block).toBe(false);     // user stopping → allow
  expect(decideStop({ ...live, progressed: false, idleCount: 0 }).block).toBe(true);  // 1st idle → block
  expect(decideStop({ ...live, progressed: false, idleCount: 2 }).block).toBe(false); // idleCount+1>=3 → allow
  expect(decideStop({ ...live, progressed: false, idleCount: 2 }).wedged).toBe(true); // …flagged wedged
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** (place beside `decideWake`):
```js
export const STOP_IDLE_MAX = 3; // consecutive no-progress turn-ends before the idle guard lets the loop stop

/** Pure decision for the Stop hook: keep the loop alive (block the turn from ending) unless the
 *  loop is terminal/paused, the user is stopping it, or it's wedged (no progress for idleMax turns). */
export function decideStop({ loopStatus, hasPendingStop, progressed, idleCount, idleMax = STOP_IDLE_MAX }) {
  if (!loopStatus || TERMINAL_STATUSES.includes(loopStatus))
    return { block: false, reason: `loop status is ${loopStatus ?? "none"}` };
  if (loopStatus === "paused") return { block: false, reason: "loop is paused" };
  if (hasPendingStop) return { block: false, reason: "user stop/pause message pending" };
  if (!progressed && idleCount + 1 >= idleMax)
    return { block: false, wedged: true, reason: `wedged: no progress for ${idleMax} turns` };
  return { block: true, reason: progressed ? "loop progressing — continue" : "no progress yet — continue" };
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(cli): decideStop — bounded never-stop decision"`

---

## Task 4: `hasPendingStop` + `sessionStartContext`

**Files:** `cli/autoloop.mjs`, `functions/test/cli.unit.test.ts`.

- [ ] **Step 1: Write failing tests** (add both helpers to the import):
```ts
it("hasPendingStop: exact-match stop/pause, ignores other text", () => {
  expect(hasPendingStop([{ text: "Stop" }])).toBe(true);
  expect(hasPendingStop([{ text: "  pause " }])).toBe(true);
  expect(hasPendingStop([{ text: "don't stop" }])).toBe(false);   // not an exact command
  expect(hasPendingStop([{ text: "add dark mode" }])).toBe(false);
  expect(hasPendingStop([])).toBe(false);
});
it("sessionStartContext: resume note when resumable, null otherwise", () => {
  const running = { loop: { id: "loop-1", status: "running", currentTaskId: "t2" }, tasks: [{ id: "t2", status: "running" }], pendingMessages: [] };
  expect(sessionStartContext(running)).toMatch(/loop resume/);
  expect(sessionStartContext({ loop: { status: "completed" } })).toBeNull();
  expect(sessionStartContext({ loop: { status: "paused" } })).toBeNull();
  expect(sessionStartContext(null)).toBeNull();
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement:**
```js
/** True iff any pending message is an exact stop/pause command (trimmed, case-insensitive). */
export function hasPendingStop(pendingMessages) {
  return (pendingMessages ?? []).some((m) => {
    const t = String(m?.text ?? "").trim().toLowerCase();
    return t === "stop" || t === "pause";
  });
}

/** The additionalContext to re-inject after compaction/resume, or null when there's no
 *  resumable loop (so non-loop and paused/terminal sessions are never nagged). */
export function sessionStartContext(state) {
  if (!isResumable(state)) return null;
  const next = firstNonTerminalTask(state);
  const loopId = state?.loop?.id ?? "the current loop";
  return `An Autoloop loop is mid-flight (loop ${loopId}${next ? `, next task: ${next.title ?? next.id}` : ""}). `
    + `Your context may have just been compacted or resumed — run \`autoloop loop resume\` now and continue from Step 0. `
    + `Compaction/summarization is NOT a stop.`;
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(cli): hasPendingStop + sessionStartContext helpers"`

---

## Task 5: `installRelaunch` registers SessionStart + Stop (idempotent)

**Files:** `cli/autoloop.mjs`, `functions/test/cli.unit.test.ts`.

- [ ] **Step 1: Write the failing test.** If an `installRelaunch` test exists, extend it; else add one that calls it with a temp `projDir` (containing an initialized `.autoloop.json` via `saveConfig`), `env.HOME` = temp, and a stub `execImpl`/`platform: "linux"` (avoids launchctl), then reads `.claude/settings.json`:
```ts
it("installRelaunch registers SessionEnd + SessionStart + Stop, idempotently", () => {
  const dir = tmp(); saveConfig(dir, { teamId: "t", projectSlug: "p", apiUrl: "http://api" });
  const env = { HOME: tmp(), AUTOLOOP_API_KEY: "al_k" };
  const opts = { cwd: dir, env, log: () => {}, err: () => {}, execImpl: () => "", platform: "linux" };
  await run(["init", "--relaunch"], opts); await run(["init", "--relaunch"], opts); // twice → must not duplicate
  const s = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
  const cmds = (ev) => (s.hooks[ev] ?? []).flatMap((h) => h.hooks.map((x) => x.command));
  expect(cmds("SessionEnd").filter((c) => c.includes("hook session-end"))).toHaveLength(1);
  expect(cmds("SessionStart").filter((c) => c.includes("hook session-start"))).toHaveLength(1);
  expect(cmds("Stop").filter((c) => c.includes("hook stop"))).toHaveLength(1);
});
```
(Drives `installRelaunch` via `run(["init","--relaunch"], …)` — the existing entry point used by the relaunch test in `cli.unit.test.ts` (~line 1340). `platform: "linux"` avoids the macOS launchctl path. No new export needed.)

- [ ] **Step 2: Run → fails** (only SessionEnd registered today).

- [ ] **Step 3: Implement** in `installRelaunch`. Define markers and dedupe both new events the same way `SessionEnd` is filtered, then push:
```js
const SESSION_START_HOOK_MARKER = "hook session-start";
const STOP_HOOK_MARKER = "hook stop";
// …alongside the existing SessionEnd filter:
settings.hooks.SessionStart = (settings.hooks.SessionStart ?? [])
  .filter((h) => !h.hooks?.some((hh) => hh.command?.includes(SESSION_START_HOOK_MARKER)));
settings.hooks.Stop = (settings.hooks.Stop ?? [])
  .filter((h) => !h.hooks?.some((hh) => hh.command?.includes(STOP_HOOK_MARKER)));
// …and in the install (non-uninstall) path, beside the SessionEnd push:
settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: `node "${stableCli}" hook session-start` }] });
settings.hooks.Stop.push({ hooks: [{ type: "command", command: `node "${stableCli}" hook stop` }] });
```
The dedupe filters run unconditionally (before the uninstall branch), so `--uninstall` also strips them. (Markers double as the dispatch subcommand strings.)

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(cli): relaunch installer registers SessionStart + Stop hooks (idempotent)"`

---

## Task 6: `hook session-start` handler

**Files:** `cli/autoloop.mjs`, `functions/test/cli.unit.test.ts`.

- [ ] **Step 1: Write the failing test** via `run(["hook","session-start"], …)` with a temp project + temp `env.HOME` + injected `fetchImpl` returning a resumable state bundle; capture `log`:
```ts
it("hook session-start emits resume additionalContext when a loop is resumable", async () => {
  const dir = tmp(); saveConfig(dir, { teamId: "t", projectSlug: "p", apiUrl: "http://api", currentLoopId: "loop-1" });
  const out = [];
  const state = { state: { loop: { id: "loop-1", status: "running", currentTaskId: "t2" }, phases: [], tasks: [{ id: "t2", status: "running" }], pendingMessages: [] } };
  await run(["hook", "session-start"], { cwd: dir, env: { HOME: tmp(), AUTOLOOP_API_KEY: "al_k" },
    log: (m) => out.push(m), err: () => {}, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ state: state.state }) }) });
  const emitted = JSON.parse(out.join("\n"));
  expect(emitted.hookSpecificOutput.additionalContext).toMatch(/loop resume/);
});
// and: a terminal/paused loop (or no key) emits nothing (out stays empty)
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** the dispatch case (mirror `hook session-end`'s env/stdin/config preamble; emit to `log`, diagnostics to `hookLog`, always `return 0`):
```js
case "hook session-start": {
  const henv = loadAutoloopEnv(env);
  const hook = readHookStdin();                 // { source, cwd, ... } (may be null)
  const projDir = hook?.cwd || cwd;
  let cfg; try { cfg = loadConfig(projDir); } catch { return 0; }
  const fetched = await fetchResumeState(cfg, henv, fetchImpl);
  const ctx = fetched ? sessionStartContext(fetched.state) : null;
  hookLog(henv, "session-start", `source=${hook?.source ?? "?"} inject=${!!ctx}`, now());
  if (ctx) log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx } }));
  return 0;
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(cli): hook session-start — re-inject resume intent after compaction"`

---

## Task 7: `hook stop` handler (+ `.stop.json` idle state + wedged record)

**Files:** `cli/autoloop.mjs`, `functions/test/cli.unit.test.ts`.

- [ ] **Step 1: Add `stopPath` + write the failing tests.** Test block-then-allow across calls with a stable vs advancing `fetchImpl`, asserting the emitted `{"decision":"block"}` and that after `STOP_IDLE_MAX` no-progress calls it stops (no block emitted). Use a temp `env.HOME` so `.stop.json` is sandboxed:
```ts
it("hook stop blocks a live, progressing loop and allows after STOP_IDLE_MAX idle turns", async () => {
  const dir = tmp(); saveConfig(dir, { teamId: "t", projectSlug: "p", apiUrl: "http://api", currentLoopId: "L" });
  const HOME = tmp();
  const stuck = { loop: { id: "L", status: "running", currentTaskId: "t1" }, phases: [], tasks: [{ id: "t1", status: "running" }], openBugs: [], scenarios: [], pendingMessages: [] };
  const call = async () => { const out = []; await run(["hook", "stop"], { cwd: dir, env: { HOME, AUTOLOOP_API_KEY: "al_k" },
    log: (m) => out.push(m), err: () => {}, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ state: stuck }) }) }); return out.join(""); };
  // Call 1 establishes the fingerprint (prev was null ⇒ progressed=true, idle NOT incremented).
  // Calls 2–3 are the real no-progress turns (idle 0→1, 1→2); call 4 trips the cap (2+1≥3 ⇒ allow).
  expect(JSON.parse(await call()).decision).toBe("block");   // 1: establish fingerprint
  expect(JSON.parse(await call()).decision).toBe("block");   // 2: idle 0→1
  expect(JSON.parse(await call()).decision).toBe("block");   // 3: idle 1→2
  expect(await call()).toBe("");                             // 4: idle 2→3 ≥ max → allow (no block)
});
```
> **Off-by-one to respect:** the FIRST `hook stop` for a fresh loop has no stored fingerprint, so `progressed === true` and the idle counter is not incremented — it's the call that *records* the baseline. Only subsequent no-progress calls increment. So a wedged loop stops after `STOP_IDLE_MAX` *no-progress* turns, i.e. `STOP_IDLE_MAX + 1` total turn-ends including the baseline. (To assert the cap without the baseline call, a test may instead pre-seed `.stop.json` via `stopPath(env, key)` with the stuck fingerprint at `idleCount: 0`.)

(Add a second test: a `pendingMessages: [{ text: "stop" }]` bundle → allow immediately, and a `status: "paused"` bundle → allow.)

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.** Add `stopPath` beside `stampsPath`:
```js
export function stopPath(env, key) { return join(autoloopHome(env), "run", `${key}.stop.json`); }
```
Then the dispatch case:
```js
case "hook stop": {
  const henv = loadAutoloopEnv(env);
  const hook = readHookStdin();
  const projDir = hook?.cwd || cwd;
  let cfg; try { cfg = loadConfig(projDir); } catch { return 0; }
  const fetched = await fetchResumeState(cfg, henv, fetchImpl);
  const state = fetched?.state;
  const key = `${cfg.teamId}-${cfg.projectSlug}`;
  const sp = stopPath(henv, key);
  const prev = readLock(sp) ?? { fingerprint: null, idleCount: 0 };   // readLock = generic JSON read
  const fingerprint = state ? stopFingerprint(state) : null;
  const progressed = fingerprint !== prev.fingerprint;
  const idleCount = progressed ? 0 : prev.idleCount;
  const d = decideStop({
    loopStatus: state?.loop?.status,
    hasPendingStop: hasPendingStop(state?.pendingMessages),
    progressed, idleCount,
  });
  // persist: reset idle on progress/allow; else increment
  const nextIdle = d.block ? idleCount + (progressed ? 0 : 1) : 0;
  try { mkdirSync(join(autoloopHome(henv), "run"), { recursive: true });
    writeFileSync(sp, JSON.stringify({ fingerprint, idleCount: nextIdle })); } catch { /* best-effort */ }
  hookLog(henv, "stop", `loop=${state?.loop?.status ?? "none"} progressed=${progressed} idle=${idleCount} → ${d.block ? "BLOCK" : "ALLOW"} (${d.reason})`, now());
  if (d.wedged) { // loud, best-effort record so the user sees why it stopped
    const api = resolveApiUrl(cfg, henv, undefined);
    await report({ method: "POST", url: `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages`,
      body: { text: `⚠ Autoloop loop stopped: no progress for ${STOP_IDLE_MAX} turns (wedged). Restart when ready.` } },
      { env: henv, fetchImpl, err, teamId: cfg.teamId });
  }
  if (d.block) log(JSON.stringify({ decision: "block", reason: d.reason + " — run `autoloop loop resume` and continue (Step 2a). Do not stop until the loop is terminal or the user stops it." }));
  return 0;
}
```

- [ ] **Step 4: Run → pass + full file** — `cd functions && npm run test:run -- cli.unit`.
- [ ] **Step 5: Commit.** `git commit -am "feat(cli): hook stop — keep the loop alive (bounded idle guard)"`

---

## Task 8: Sync distribution copies + final verification

- [ ] **Step 1: Sync** — `bash scripts/sync-autoloop-cli.sh`.
- [ ] **Step 2: Verify copies match** — `diff -q cli/autoloop.mjs web/public/skill/autoloop.mjs && diff -q cli/autoloop.mjs plugins/autoloop/bin/autoloop` (and the SKILL copy).
- [ ] **Step 3: Full CLI test run** — `cd functions && npm run test:run -- cli.unit` (all green) and `npm run build` (functions type-check clean).
- [ ] **Step 4: Commit the synced copies.**
```bash
git add cli/autoloop.mjs web/public/skill/autoloop.mjs plugins/autoloop/bin/autoloop web/public/skill/autoloop/SKILL.md plugins/autoloop/skills/autoloop/SKILL.md
git commit -m "chore: sync autoloop CLI + skill distribution copies"
```

---

## Notes for the implementer

- **Idle guard + relaunch backoff compose.** When the Stop hook allows a stop due to the idle cap, a headless `-p` session then exits → the existing `SessionEnd` relaunch sees a resumable loop and may relaunch it. That's intended: the outer bound is the existing crash-loop backoff (`RELAUNCH_MAX=3` / 30 min), so a truly wedged loop is stopped within ≈ `STOP_IDLE_MAX × RELAUNCH_MAX` turns, and the wedged message is posted each time so the user sees it. Don't try to also pause the loop from the Stop hook — keep the two mechanisms independent.
- **stdout hygiene:** only the single control-JSON line goes to stdout (`log`). Everything else is `hookLog` (file). A stray `console.log` in these handlers would corrupt the hook output.
- **Always `return 0`** from both handlers on every path (including the `loadConfig`/network failures) — a hook that errors must never wedge the session.
- **Don't touch** `decideSessionEndRelaunch` / `decideWake` / the SessionEnd handler — they correctly handle genuine termination and stay as-is.
- Confirm the `installRelaunch` test entry point against the existing test file (export `installRelaunch`, or drive via `run(["init","--relaunch"])`) before writing Task 5's test.
