# Daloop reporting (Codex usage)

Same CLI as the Claude Code skill — for a Codex-driven loop, add the following to
your task/system instructions. `daloop` below is shorthand for:

```
node "$HOME/.claude/skills/daloop-reporting/daloop.mjs"
```

The CLI has no dependencies (Node 22+).

Reporting is **best-effort**: if a `daloop` command warns, log it and continue —
never let a status report block the real work. Reporting failures exit `0` by
default (pass `--strict` only if you want them fatal).

## Setup (once)

- Ensure `DALOOP_API_KEY` is in the environment (a per-user key minted in the
  Daloop app under **API keys**; you must be a member of the team).
- `daloop init --team <teamId> --project <slug>` — writes `.daloop.json` in the
  working directory. (Pass `--url <apiUrl>` only to target a non-default deployment.)

## During the loop

```
# at project start:
daloop project set --title "<title>" --status running --design-file <plan-or-spec>

# entering a phase:
daloop phase start <phaseId> --name "<name>" --order <n>

# after each git commit:
daloop commit

# leaving a phase:
daloop phase set <phaseId> --status completed   # or failed

# loop end:
daloop project set --status completed            # or failed / cancelled
```

`status` ∈ `queued|running|blocked|paused|completed|failed|cancelled`.
IDs must match `^[a-z0-9._-]+$`. `daloop commit` reads git HEAD and attaches the
commit to the current phase.
