# daloop-reporting (Claude Code plugin)

A Claude Code plugin that lets agentic development loops report their status —
project, phases, and commits — to a [Daloop](https://daloop-42b47.web.app)
dashboard, via the bundled `daloop` CLI.

## Install

```
/plugin marketplace add openloopagentics/daloop
/plugin install daloop-reporting@daloop
```

Then enable auto-update in `/plugin` → **Marketplaces** → `daloop`, or update
manually any time with `/plugin marketplace update daloop`.

## After installing (one-time)

1. Mint a key in the Daloop app → **API keys**, then `export DALOOP_API_KEY=…`
2. In a loop's working directory: `daloop init --team <teamId> --project <slug>`

The skill then auto-activates when a loop should report status. See
`skills/daloop-reporting/SKILL.md`.

## Layout

```
plugins/daloop-reporting/
├── .claude-plugin/plugin.json
├── skills/daloop-reporting/
│   ├── SKILL.md          # invoked by Claude Code
│   └── CODEX.md          # same commands, for Codex loops
└── bin/daloop            # the CLI (added to $PATH when the plugin is active)
```

`bin/daloop` is a copy of the canonical `cli/daloop.mjs` at the repo root.
After changing the CLI, resync the copies with `scripts/sync-daloop-cli.sh`.
