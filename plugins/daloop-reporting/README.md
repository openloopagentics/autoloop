# daloop-reporting (Claude Code plugin)

A Claude Code plugin that lets you author a vision, drive a self-evaluating
development loop, and report its status — goals, scenarios, scores, phases,
and commits — to a [Daloop](https://daloop-42b47.web.app) dashboard, via the
bundled `daloop` CLI.

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

The skills auto-discover and activate automatically. See the **Skills** section
below for a description of each.

## Skills

| Skill | SKILL.md | Purpose |
|-------|----------|---------|
| `daloop-reporting` | `skills/daloop-reporting/SKILL.md` | Report a loop's live status (project, phases, commits, scores) to the Daloop dashboard. Auto-activates while a loop is running. |
| `daloop-vision` | `skills/daloop-vision/SKILL.md` | Interview the user to author a `vision.json` file (goals, user scenarios, rubrics). Run once before starting the loop. |
| `daloop` | `skills/daloop/SKILL.md` | Drive the vision-driven self-evaluating development loop: plan → execute → score → iterate, using the `vision.json` produced by `daloop-vision`. (Invoke with `/daloop`.) |

## Layout

```
plugins/daloop-reporting/
├── .claude-plugin/plugin.json
├── skills/daloop-reporting/
│   ├── SKILL.md          # invoked by Claude Code
│   └── CODEX.md          # same commands, for Codex loops
├── skills/daloop-vision/
│   └── SKILL.md          # vision authoring interview
├── skills/daloop/
│   └── SKILL.md          # vision-driven self-evaluating loop driver (/daloop)
└── bin/
    ├── daloop            # the CLI (added to $PATH when the plugin is active)
    └── vision-schema.mjs # JSON schema validator for vision.json
```

`bin/daloop` is a copy of the canonical `cli/daloop.mjs` at the repo root.
After changing the CLI, resync the copies with `scripts/sync-daloop-cli.sh`.
