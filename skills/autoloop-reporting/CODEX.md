# Autoloop reporting (Codex usage)

Same CLI as the Claude Code skill — for a Codex-driven loop, add the following to
your task/system instructions. The CLI is `node <repo>/cli/autoloop.mjs` (referred to
as `autoloop` below). It has no dependencies (Node 22+).

Reporting is **best-effort**: if a `autoloop` command warns, log it and continue —
never let a status report block the real work. Reporting failures exit `0` by
default (pass `--strict` only if you want them fatal).

## Setup (once)

- Ensure `AUTOLOOP_API_KEY` is in the environment (a per-user key minted via
  `POST /v1/keys`; the user must be a member of the team).
- `autoloop init --team <teamId> --project <slug> [--url <apiUrl>]` — writes
  `.autoloop.json` in the working directory.

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
