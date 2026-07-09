---
name: autoloop-vision
description: Use to author or extend a project's Autoloop vision — interview the user to produce a validated vision wiki (a vision/ directory of markdown pages with goals, scenarios, scoring rubrics, and optional per-scenario test commands embedded as fenced blocks; legacy vision.json also supported). Trigger when the user wants to define what "done" means for a vision-driven loop, set up scenarios/rubrics, or says "author a vision", "/autoloop-vision", or "set up the loop's goals".
---

# Autoloop Vision Authoring

Interview the user to produce a **vision wiki** — a `vision/` directory of markdown
pages that tells the product's story in prose, with the goals, scenarios, scoring
rubrics, and (optional) per-scenario test commands woven in as fenced blocks. The
`/autoloop` driver later builds toward and scores against those blocks; the dashboard
renders the pages as a living wiki the team can read and comment on.

## Output: the `vision/` wiki

Write markdown pages under `vision/` in the loop's working directory:

- **An overview page** (`vision/overview.md`) that tells the product story — what it
  is, who it's for, the shape of the outcome — with `order: 0` so it sorts first.
- **One page per goal** (`vision/<goal-id>.md`) — the goal's prose, then its `goal`
  block, then each scenario's prose followed by its `scenario` block.

Each page carries YAML-subset frontmatter and embeds definitions in fenced
```` ```goal ```` / ```` ```scenario ```` blocks. Example goal page:

````markdown
---
id: sign-in
title: Sign in
order: 1
---

Users need to get into the app with an email and password, and be told clearly
when their credentials are wrong.

```goal
id: sign-in
title: Sign in
order: 1
```

Email + password login succeeds and lands the user on their dashboard.

```scenario
id: login-succeeds
goalId: sign-in
title: Login succeeds
order: 1
threshold: 80
rubric: {"criteria": [{"id": "correctness", "name": "Correctness", "weight": 3, "max": 5}]}
test: {"command": "npm test -- auth"}
```
````

Field rules (goals + scenarios inside the blocks):
- ids match `^[a-z0-9._-]+$` (lowercase kebab/dot/underscore, no spaces).
- every `scenario.goalId` must reference a defined goal.
- rubric `criteria` non-empty; each `{ id, name, weight>0, max≥1 (integer) }`.
- `order` (where present) is an integer; `threshold` optional, `0..100` (default 80).
- scenario `test` is an **object `{ command: "..." }`**, never a bare string; omit it
  to let the loop AI-judge the scenario. It stays loop-local — sync strips it before
  upload, so it lives only in the repo.

Frontmatter rules (every page):
- `id` **required**, matches `^[a-z0-9._-]+$`, unique across pages (it is immutable —
  it's how comments and diffs anchor to a page).
- `title` **required**, a non-empty string.
- `order` optional integer (defaults 0); sets the page's position in the wiki.

Block/frontmatter body grammar — a **restricted YAML subset** (JSON is a superset and
is always accepted, so when in doubt, write the value as inline JSON):
- `key: value` maps; nesting by **exactly 2-space indent** per level. **No tabs.**
- `- ` list items are a scalar OR inline JSON (`{...}` / `[...]`). **Block-style
  list-of-maps is NOT supported** — write each list-of-objects item as inline JSON
  (as `rubric.criteria` is above).
- Scalars coerce: `true`/`false` → boolean, integer/float → number, else string.
- **A goal/scenario description must NOT contain a line starting with ```` ``` ````** —
  a stray fence would swallow the real block. Keep fences out of prose.

## Process

1. **Load or start fresh.** If a `vision/` directory exists in the cwd, read its pages
   and offer to extend; otherwise start a new wiki (and see step 5 if the user has a
   legacy `vision.json` to convert).
2. **Interview one topic at a time** (don't dump a form):
   - Elicit the **product story** for the overview page, then the **goals** (high-level
     outcomes), in priority order.
   - For each goal, its **scenarios** (the acceptance units — concrete, testable
     "this works" statements).
   - For each scenario: a one-line description; the **rubric criteria** (name +
     integer `max` + relative `weight`); an optional **threshold**; and a **test**:
     ask for a shell command that verifies it (e.g. `npm test -- login`) or "let the
     loop AI-judge it" (then omit `test`).
   - Prefer the user's own words for the prose and titles. Assign stable kebab-case ids.
3. **Validate before syncing.** Parse the wiki locally to catch errors with a
   file:line before anything uploads:

   ```bash
   autoloop vision sync   # parses vision/*.md, fails fast on any parse/validation error
   ```

   `vision sync` parses every page, validates the extracted goals/scenarios, and only
   then diffs page hashes against the server — pushing changed pages, deleting pages
   removed from disk, and upserting the goals/scenarios. On a parse error it prints
   `file:line: message` and uploads **nothing** — fix the page with the user and
   re-sync. **Never leave the wiki unsyncable.**
4. **Confirm** the written pages with the user.
5. **Converting an existing `vision.json`.** If the user already has a legacy
   `vision.json`, generate the wiki from it instead of authoring from scratch:

   ```bash
   autoloop vision migrate   # reads vision.json, writes vision/*.md (refuses to overwrite an existing vision/)
   ```

   It is purely local (no network), self-checks that the generated wiki round-trips to
   the same goals/scenarios, and prints next steps. Review the pages, add prose, then
   `autoloop vision sync`. (`--file <vision.json>` / `--dir <other>` override the
   defaults.)

Syncing requires an API key (a `.autoloop.key` file in the cwd, or `AUTOLOOP_API_KEY`
in the env) and an initialised `.autoloop.json`. If the dir isn't initialised, point
the user to `autoloop init --team <t> --project <slug> [--key <apiKey>]` (and the
Autoloop app's API-keys page to mint a key).

### Legacy path: `vision.json` + `vision import`

A single `vision.json` (goals, scenarios, rubrics, `documents`) remains fully
supported. Its shape:

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

Validate it with `node <vision-schema.mjs> vision.json` (the validator is at
`${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs` as a plugin, or alongside this skill via
the curl `/skill` installer), then push with `autoloop vision import --file vision.json`
(best-effort; the loop-local `scenario.test` field is dropped on import and stays in
your local `vision.json`). Prefer the wiki for new projects — `vision migrate` upgrades
a legacy `vision.json` into one.

## Boundaries

- You author the **what** (the vision wiki). You do NOT generate the plan, write code,
  run tests, or score anything — that is `/autoloop`'s job. When the wiki is synced,
  tell the user they can run `/autoloop` to build toward it.
- Keep scenarios concrete and few; a good first vision is 1–3 goals with 1–3 scenarios
  each. Resist inventing criteria the user didn't ask for (YAGNI).

## Example (abbreviated interview → result)

> "What's the first outcome you want?" → "Users can sign in."
> "How do we know it works?" → "Email+password login succeeds; bad password is rejected."
> "How should I score 'login succeeds' — what matters?" → "Correctness most, then UX."
> "A test command, or AI-judge it?" → "`npm test -- auth`"

Produces `vision/overview.md` (the product story) and `vision/sign-in.md` with goal
`sign-in` and scenarios `login-succeeds` (test: `npm test -- auth`) and
`bad-password-rejected`, each with a correctness+ux rubric, ending in
`autoloop vision sync`.
