---
name: daloop-vision
description: Use to author or extend a project's Daloop vision — interview the user to produce a validated vision.json (goals, scenarios, scoring rubrics, optional per-scenario test commands). Trigger when the user wants to define what "done" means for a vision-driven loop, set up scenarios/rubrics, or says "author a vision", "/daloop-vision", or "set up the loop's goals".
---

# Daloop Vision Authoring

Interview the user to produce a **`vision.json`** — the goals, scenarios, scoring
rubrics, and (optional) per-scenario test commands that the `/daloop-loop` driver
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
    "test": { "command": "npm test -- login" }   // optional; omit → the loop AI-judges it
  }],
  "documents": [{ "id": "vision", "kind": "vision", "title": "Vision", "format": "markdown", "content": "..." }]
}
```

Field rules:
- ids match `^[a-z0-9._-]+$` (lowercase kebab/dot/underscore, no spaces).
- every `scenario.goalId` must reference a defined goal.
- rubric `criteria` non-empty; each `{ id, name, weight>0, max≥1 (integer) }`.
- `order` (where present) is an integer; `threshold` optional, `0..100` (global
  default 80). `document.format` ∈ `markdown|url`; `document.content` ≤ 100KB.

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
3. **Validate before writing.** Write your candidate to `vision.json`, then run the
   bundled validator: run `node <vision-schema.mjs> vision.json`, where the validator is
   at `${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs` when installed as a plugin, or
   alongside this skill (`vision-schema.mjs` in the skill's own directory) when installed
   via the curl `/skill` installer. If it isn't found, validate the fields manually
   against the rules above before writing.
   If it reports problems, fix them with the user and re-run — **never leave an
   invalid vision.json**.
4. **Confirm** the written `vision.json` with the user.
5. **Offer to push it:** `daloop vision import --file vision.json` (best-effort).
   Requires `DALOOP_API_KEY` in the env and an initialised `.daloop.json`. If the dir
   isn't initialised, point the user to `daloop init --team <t> --project <slug>`
   (and the Daloop app's API-keys page to mint a key). The loop-local `scenario.test`
   field is dropped on import (it stays in your local `vision.json`).
6. **Persist the test approach (optional).** When a scenario has a non-trivial test
   approach — a command or a described verification procedure — optionally persist it as
   a Document of `kind: "test-spec"`, e.g. `daloop doc add --kind test-spec --title
   "<scenario> tests" --file <notes.md>` (or `--url <link>`), so the loop and the
   dashboard share the test definition. This is optional; the loop reads it when present.

## Boundaries

- You author the **what** (the vision). You do NOT generate the plan, write code, run
  tests, or score anything — that is `/daloop-loop`'s job. When the vision is ready,
  tell the user they can run `/daloop-loop` to build toward it.
- Keep scenarios concrete and few; a good first vision is 1–3 goals with 1–3 scenarios
  each. Resist inventing criteria the user didn't ask for (YAGNI).

## Example (abbreviated interview → result)

> "What's the first outcome you want?" → "Users can sign in."
> "How do we know it works?" → "Email+password login succeeds; bad password is rejected."
> "How should I score 'login succeeds' — what matters?" → "Correctness most, then UX."
> "A test command, or AI-judge it?" → "`npm test -- auth`"

Produces a `vision.json` with goal `sign-in`, scenarios `login-succeeds` (test:
`npm test -- auth`) and `bad-password-rejected`, each with a correctness+ux rubric.
