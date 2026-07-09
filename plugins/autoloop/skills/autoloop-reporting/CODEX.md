# Autoloop reporting (Codex usage)

Same CLI as the Claude Code skill — for a Codex-driven loop, add the following to
your task/system instructions. The bundled `autoloop` CLI is on your `PATH` when this
plugin is active (Node 22+, no other deps); otherwise invoke it directly as
`node "${CLAUDE_PLUGIN_ROOT}/bin/autoloop"`.

Reporting is **best-effort**: if a `autoloop` command warns, log it and continue —
never let a status report block the real work. Reporting failures exit `0` by
default (pass `--strict` only if you want them fatal).

## Setup (once)

- Ensure an API key is available: preferred is a `.autoloop.key` file in the loop's
  working directory (gitignore it); `AUTOLOOP_API_KEY` in the environment overrides
  it. Keys are per-user, minted in the Autoloop app under **API keys** (you must be
  a member of the team).
- `autoloop init --team <teamId> --project <slug> [--key <apiKey>]` — writes
  `.autoloop.json` (and `.autoloop.key` with `--key`) in the working directory.
  (Pass `--url <apiUrl>` only to target a non-default deployment.)

## During the loop

```
# at project start:
autoloop project set --title "<title>" --status running --design-file <plan-or-spec>

# entering a phase:
autoloop phase start <phaseId> --name "<name>" --order <n>

# after each git commit:
autoloop commit

# leaving a phase:
autoloop phase set <phaseId> --status completed   # or failed

# loop end:
autoloop project set --status completed            # or failed / cancelled
```

`status` ∈ `queued|running|blocked|paused|completed|failed|cancelled`.
IDs must match `^[a-z0-9._-]+$`. `autoloop commit` reads git HEAD and attaches the
commit to the current phase.

## Vision wiki

```
# push the repo vision wiki (vision/*.md) — parses + validates locally, then diffs
# page hashes and pushes only what changed (PUT changed, DELETE removed, upsert goals/scenarios):
autoloop vision sync                  # [--dir vision] [--strict]

# convert a legacy vision.json into a wiki (local-only; refuses to overwrite vision/):
autoloop vision migrate               # [--file vision.json] [--dir vision]

# legacy: push a single vision.json:
autoloop vision import --file vision.json
```

`vision sync` fails fast with `file:line` on a parse error and uploads nothing; fix the
page and re-sync. `vision migrate` self-checks the round-trip — review + commit the
pages, then `vision sync`.

## Steering comments

Users comment on Vision pages to steer the loop. Answer every open comment:

```
autoloop comments pull                # list open comments (--check = silent exit-0-iff-any probe)
autoloop comments reply <id> --text "<message>"
autoloop comments resolve <id> [--declined] [--note "<text>"]
```

A **blocking** comment suppresses its target scenario's met until the loop resolves it
AND the comment's author or a team admin accepts.
