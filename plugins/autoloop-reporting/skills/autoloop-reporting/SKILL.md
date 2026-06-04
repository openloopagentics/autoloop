---
name: autoloop-reporting
description: Use when running a development loop that should report its status (project, phases, commits) to an Autoloop dashboard. Reports via the bundled autoloop CLI as the loop progresses. Requires AUTOLOOP_API_KEY in the environment and a one-time `autoloop init`.
---

# Autoloop Reporting

Report the loop's status to Autoloop as you work, using the bundled **`autoloop`**
CLI (this plugin adds it to your `PATH`; it needs Node 22+, no other deps).
Reporting is **best-effort observability** — it must never block or derail the
actual development work.

## Prerequisites (set up once)

- **`AUTOLOOP_API_KEY`** must be set in the environment — a per-user key minted in
  the Autoloop app under **API keys** (you must be a member of the team you report
  to). The CLI never reads the key from a file.
- Run **`autoloop init`** once in the loop's working directory to write `.autoloop.json`:

  ```
  autoloop init --team <teamId> --project <slug>
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
