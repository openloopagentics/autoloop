---
name: autoloop-vision
description: Use to author or extend a project's Autoloop vision — interview the user to produce a validated vision.json (goals, scenarios, scoring rubrics, optional per-scenario test commands). Trigger when the user wants to define what "done" means for a vision-driven loop, set up scenarios/rubrics, or says "author a vision", "/autoloop-vision", or "set up the loop's goals".
---

# Autoloop Vision Authoring

Interview the user to produce a **`vision.json`** — the goals, scenarios, scoring
rubrics, and (optional) per-scenario test commands that the `/autoloop` driver
later builds toward and scores against.

## Output: vision.json

Write `vision.json` in the loop's working directory. Shape (validated before writing):

```jsonc
{
  "goals":     [{ "id": "g1", "title": "...", "description": "...", "order": 1 }],
  "scenarios": [{
    "id": "login-works", "goalId": "g1", "title": "...", "description": "...",
    "order": 1, "threshold": 80,
    "rubric": { "criteria": [{ "id": "correctness", "name": "Correctness", "weight": 3, "max": 5 }] },
    "test": { "command": "npm test -- login" },  // optional; omit → unverified (loop AI-judges, can't auto-meet at L2+)
    "governance": { "autonomy": "L2" }            // optional per-scenario override of the top-level block
  }],
  "documents": [{ "id": "vision", "kind": "vision", "title": "Vision", "format": "markdown", "content": "..." }],
  "governance": {                                  // optional, loop-local — governs how far the loop runs on its own
    "autonomy": "L2",                              // L1 report-only | L2 assisted (default) | L3 unattended
    "dailyTokenCap": 500000,                       // integer ≥ 10000; loop self-throttles at 80%, stops at 100%
    "earlyExit": true,                             // exit cheaply when there's no actionable work
    "humanGates": ["payments", "auth"]             // areas that always require user sign-off
  }
}
```

Field rules:
- ids match `^[a-z0-9._-]+$` (lowercase kebab/dot/underscore, no spaces).
- every `scenario.goalId` must reference a defined goal.
- rubric `criteria` non-empty; each `{ id, name, weight>0, max≥1 (integer) }`.
- `order` (where present) is an integer; `threshold` optional, `0..100` (global
  default 80). `document.format` ∈ `markdown|url`; `document.content` ≤ 100KB.
- `governance` (top-level and/or per-scenario, both optional): `autonomy` ∈
  `L1|L2|L3`; `dailyTokenCap` integer ≥ 10000; `earlyExit` boolean; `humanGates`
  array of non-empty strings. **Loop-local** — stripped on import, never sent to the
  server (like `test`). Default autonomy when omitted is **L1 (report-only)**.

## Process

1. **Load or start fresh.** If `vision.json` exists in the cwd, read it and offer to
   extend; otherwise start a new one.
2. **Interview one topic at a time** (don't dump a form):
   - Elicit the **goals** (high-level outcomes), in priority order.
   - For each goal, its **scenarios** (the acceptance units — concrete, testable
     "this works" statements).
   - For each scenario: a one-line description; the **rubric criteria** (name +
     integer `max` + relative `weight`); an optional **threshold**; and a **test**:
     ask for a shell command that verifies it (e.g. `npm test -- login`) or "let the
     loop AI-judge it" (then omit `test`).
   - Prefer the user's own words for titles/descriptions. Assign stable kebab-case ids.
   - **Governance (optional, ask last).** Offer a one-question check on how far the
     loop may run on its own: autonomy level (**L1** report-only / **L2** assisted /
     **L3** unattended), an optional daily token cap, and any **human-gate** areas that
     must always get sign-off (e.g. payments, auth). If the user doesn't care, omit the
     block — it defaults to L1 (report-only, safest). Suggested caps by scope mirror
     loop-engineering: a light triage-style loop ~80–100k/day, a heavier build loop
     ~500k–2M/day.
3. **Validate before writing.** Write your candidate to `vision.json`, then run the
   bundled validator: run `node <vision-schema.mjs> vision.json`, where the validator is
   at `${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs` when installed as a plugin, or
   alongside this skill (`vision-schema.mjs` in the skill's own directory) when installed
   via the curl `/skill` installer. If it isn't found, validate the fields manually
   against the rules above before writing.
   If it reports problems, fix them with the user and re-run — **never leave an
   invalid vision.json**.
4. **Confirm** the written `vision.json` with the user.
5. **Offer to push it:** `autoloop vision import --file vision.json` (best-effort).
   Requires an API key (a `.autoloop.key` file in the cwd, or `AUTOLOOP_API_KEY` in the
   env) and an initialised `.autoloop.json`. If the dir isn't initialised, point the user
   to `autoloop init --team <t> --project <slug> [--key <apiKey>]`
   (and the Autoloop app's API-keys page to mint a key). The loop-local `scenario.test`
   and `governance` fields are dropped on import (they stay in your local `vision.json`).
6. **Persist the test approach (optional).** When a scenario has a non-trivial test
   approach — a command or a described verification procedure — optionally persist it as
   a Document of `kind: "test-spec"`, e.g. `autoloop doc add --kind test-spec --title
   "<scenario> tests" --file <notes.md>` (or `--url <link>`), so the loop and the
   dashboard share the test definition. This is optional; the loop reads it when present.

## Boundaries

- You author the **what** (the vision). You do NOT generate the plan, write code, run
  tests, or score anything — that is `/autoloop`'s job. When the vision is ready,
  tell the user they can run `/autoloop` to build toward it.
- Keep scenarios concrete and few; a good first vision is 1–3 goals with 1–3 scenarios
  each. Resist inventing criteria the user didn't ask for (YAGNI).

## Example (abbreviated interview → result)

> "What's the first outcome you want?" → "Users can sign in."
> "How do we know it works?" → "Email+password login succeeds; bad password is rejected."
> "How should I score 'login succeeds' — what matters?" → "Correctness most, then UX."
> "A test command, or AI-judge it?" → "`npm test -- auth`"

Produces a `vision.json` with goal `sign-in`, scenarios `login-succeeds` (test:
`npm test -- auth`) and `bad-password-rejected`, each with a correctness+ux rubric.
