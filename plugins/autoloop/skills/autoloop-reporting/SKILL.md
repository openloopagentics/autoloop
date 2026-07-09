---
name: autoloop-reporting
description: Use when running a development loop that should report its status (project, phases, commits) to an Autoloop dashboard. Reports via the bundled autoloop CLI as the loop progresses. Requires an API key (a .autoloop.key file or AUTOLOOP_API_KEY in the environment) and a one-time `autoloop init`.
---

# Autoloop Reporting

Report the loop's status to Autoloop as you work, using the bundled **`autoloop`**
CLI (this plugin adds it to your `PATH`; it needs Node 22+, no other deps).
Reporting is **best-effort observability** — it must never block or derail the
actual development work.

## Prerequisites (set up once)

- **An API key** — a per-user key minted in the Autoloop app under **API keys**
  (you must be a member of the team you report to). Preferred: a **`.autoloop.key`**
  file in the loop's working directory (add it to `.gitignore`, never commit it),
  so concurrent loops on one machine each report with their own key.
  `AUTOLOOP_API_KEY` in the environment overrides the file when set.
- Run **`autoloop init`** once in the loop's working directory to write
  `.autoloop.json` (and, with `--key`, the `.autoloop.key` file):

  ```
  autoloop init --team <teamId> --project <slug> [--key <apiKey>]
  ```

  (The CLI defaults to the hosted Autoloop API; pass `--url <apiUrl>` only to point
  at a different deployment.)

## When to report (lifecycle → command)

| Loop moment | Command |
|---|---|
| Project start (once) | `autoloop init …` then `autoloop project set --title "<title>" --status running --design-file <plan-or-spec>` |
| Entering a phase | `autoloop phase start <phaseId> --name "<name>" --order <n>` |
| After each git commit | `autoloop commit` |
| Leaving a phase | `autoloop phase set <phaseId> --status completed` (or `failed`) |
| Loop end | `autoloop project set --status completed` (or `failed` / `cancelled`) |

- `autoloop commit` reads the latest git commit (sha, message, author, time) and
  attaches it to the current phase — just run it right after you commit.
- A `phaseId` is yours to choose (e.g. `build`, `design`); `phase set` reuses the
  name/order you gave at `phase start`.

## Vision wiki (push the repo `vision/` pages)

| Moment | Command |
|---|---|
| Push the vision wiki | `autoloop vision sync [--dir vision] [--strict]` |
| Convert a legacy `vision.json` → wiki | `autoloop vision migrate [--file vision.json] [--dir vision]` |
| Legacy: push a `vision.json` | `autoloop vision import --file vision.json` |

- `vision sync` parses `vision/*.md` locally first (fails fast with `file:line` on any
  parse/validation error, uploading nothing), then diffs page hashes against the server
  — PUTting changed pages, DELETEing pages removed from disk, and upserting the
  extracted goals/scenarios. Run it whenever the wiki changes. `--strict` makes a
  server-list failure fatal instead of re-uploading everything best-effort.
- `vision migrate` is purely local (no network): it writes `vision/*.md` from a legacy
  `vision.json`, refuses to overwrite an existing `vision/`, and self-checks the
  round-trip. Review + commit the pages, then `vision sync`.

## Steering comments (the loop answers user comments on Vision pages)

| Moment | Command |
|---|---|
| List open comments | `autoloop comments pull` (add `--check` for a silent exit-0-iff-any probe) |
| Reply to a comment | `autoloop comments reply <id> --text "<message>"` |
| Resolve a comment | `autoloop comments resolve <id> [--declined] [--note "<text>"]` |

- `comments resolve` marks the comment `resolved` (or `declined` with `--declined`);
  `--note` records why. A **blocking** comment suppresses its target scenario's met
  until it is resolved AND accepted by the author/team admin.

## Rules

- **Best-effort:** if a `autoloop` command prints a warning (bad key, not a team
  member, network blip), **note it and keep going** — never abort the loop over a
  reporting failure. By default such failures exit `0`; only pass `--strict` if you
  deliberately want reporting failures to be fatal.
- **Valid values:** `status` must be one of
  `queued | running | blocked | paused | completed | failed | cancelled`. IDs
  (`teamId`, `slug`, `phaseId`) must match `^[a-z0-9._-]+$` (lowercase, no spaces or
  slashes).
- **Order:** report `project set` (with title) before phases, and `phase start`
  before the `phase set`/`commit` for that phase. The CLI is resilient if you don't,
  but this keeps the dashboard accurate.

## Example

```
autoloop init --team acme --project web
autoloop project set --title "Acme Web" --status running --design-file docs/plan.md
autoloop phase start build --name "Build" --order 1
# … do work, git commit …
autoloop commit
autoloop phase set build --status completed
autoloop project set --status completed
```

> If `autoloop` isn't found on your `PATH`, invoke it directly:
> `node "${CLAUDE_PLUGIN_ROOT}/bin/autoloop" …`

See `CODEX.md` in this directory for the same commands framed for a Codex-driven loop.
