#!/usr/bin/env bash
# Installer for the Daloop Claude Code skills.
#   curl -fsSL https://daloop-42b47.web.app/skill/install.sh | bash
#
# Writes three skills into ~/.claude/skills/ :
#   - daloop-reporting (SKILL.md, CODEX.md, bundled `daloop` CLI)
#   - daloop-vision    (SKILL.md + bundled vision-schema.mjs validator)
#   - daloop           (SKILL.md — the loop driver, invoked as /daloop)
# Claude Code discovers personal skills at session start, so restart Claude Code
# (or open a new session) after installing.
set -euo pipefail

BASE="${DALOOP_SKILL_BASE:-https://daloop-42b47.web.app/skill}"
DEST="${DALOOP_SKILL_DIR:-$HOME/.claude/skills/daloop-reporting}"

say() { printf '%s\n' "$*"; }

say "Installing the daloop-reporting skill"
say "  from: $BASE"
say "  to:   $DEST"

command -v curl >/dev/null 2>&1 || { say "✗ curl is required."; exit 1; }

VISION_DEST="${DALOOP_VISION_DIR:-$HOME/.claude/skills/daloop-vision}"
LOOP_DEST="${DALOOP_LOOP_DIR:-$HOME/.claude/skills/daloop}"

# fetch SRC (relative to $BASE) into DST, atomically.
fetch() {
  local src="$1" dst="$2"
  if ! curl -fsSL "$BASE/$src" -o "$dst.tmp"; then
    say "✗ failed to download $src"; rm -f "$dst.tmp"; exit 1
  fi
  mv "$dst.tmp" "$dst"
}

mkdir -p "$DEST"
for f in SKILL.md CODEX.md daloop.mjs; do
  fetch "$f" "$DEST/$f"
done
chmod +x "$DEST/daloop.mjs"

# daloop-vision skill + its validator (the "alongside this skill" path the SKILL.md expects).
mkdir -p "$VISION_DEST"
fetch "daloop-vision/SKILL.md" "$VISION_DEST/SKILL.md"
fetch "vision-schema.mjs" "$VISION_DEST/vision-schema.mjs"
chmod +x "$VISION_DEST/vision-schema.mjs"

# daloop skill (the loop driver, invoked as /daloop).
mkdir -p "$LOOP_DEST"
fetch "daloop/SKILL.md" "$LOOP_DEST/SKILL.md"

# Node check (the CLI needs Node 22+).
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major:-0}" -lt 22 ]; then
    say "⚠ Node $(node -v) found — the daloop CLI needs Node 22+. Upgrade before using it."
  fi
else
  say "⚠ Node not found — install Node 22+ so the daloop CLI can run."
fi

say ""
say "✓ Installed daloop-reporting → $DEST"
say "✓ Installed daloop-vision    → $VISION_DEST"
say "✓ Installed daloop           → $LOOP_DEST"
say "  • Restart Claude Code (or start a new session) to load the three skills."
say "  • Mint a key in the Daloop app → API keys, then:  export DALOOP_API_KEY=…"
say "  • Initialize a loop:  node \"$DEST/daloop.mjs\" init --team <teamId> --project <slug>"
