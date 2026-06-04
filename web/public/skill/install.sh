#!/usr/bin/env bash
# Installer for the Autoloop Claude Code skills.
#   curl -fsSL https://daloop-42b47.web.app/skill/install.sh | bash
#
# Writes three skills into ~/.claude/skills/ :
#   - autoloop-reporting (SKILL.md, CODEX.md, bundled `autoloop` CLI)
#   - autoloop-vision    (SKILL.md + bundled vision-schema.mjs validator)
#   - autoloop           (SKILL.md — the loop driver, invoked as /autoloop)
# Claude Code discovers personal skills at session start, so restart Claude Code
# (or open a new session) after installing.
set -euo pipefail

BASE="${AUTOLOOP_SKILL_BASE:-https://daloop-42b47.web.app/skill}"
DEST="${AUTOLOOP_SKILL_DIR:-$HOME/.claude/skills/autoloop-reporting}"

say() { printf '%s\n' "$*"; }

say "Installing the autoloop-reporting skill"
say "  from: $BASE"
say "  to:   $DEST"

command -v curl >/dev/null 2>&1 || { say "✗ curl is required."; exit 1; }

VISION_DEST="${AUTOLOOP_VISION_DIR:-$HOME/.claude/skills/autoloop-vision}"
LOOP_DEST="${AUTOLOOP_LOOP_DIR:-$HOME/.claude/skills/autoloop}"

# fetch SRC (relative to $BASE) into DST, atomically.
fetch() {
  local src="$1" dst="$2"
  if ! curl -fsSL "$BASE/$src" -o "$dst.tmp"; then
    say "✗ failed to download $src"; rm -f "$dst.tmp"; exit 1
  fi
  mv "$dst.tmp" "$dst"
}

mkdir -p "$DEST"
for f in SKILL.md CODEX.md autoloop.mjs; do
  fetch "$f" "$DEST/$f"
done
chmod +x "$DEST/autoloop.mjs"

# autoloop-vision skill + its validator (the "alongside this skill" path the SKILL.md expects).
mkdir -p "$VISION_DEST"
fetch "autoloop-vision/SKILL.md" "$VISION_DEST/SKILL.md"
fetch "vision-schema.mjs" "$VISION_DEST/vision-schema.mjs"
chmod +x "$VISION_DEST/vision-schema.mjs"

# autoloop skill (the loop driver, invoked as /autoloop).
mkdir -p "$LOOP_DEST"
fetch "autoloop/SKILL.md" "$LOOP_DEST/SKILL.md"

# Node check (the CLI needs Node 22+).
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major:-0}" -lt 22 ]; then
    say "⚠ Node $(node -v) found — the autoloop CLI needs Node 22+. Upgrade before using it."
  fi
else
  say "⚠ Node not found — install Node 22+ so the autoloop CLI can run."
fi

say ""
say "✓ Installed autoloop-reporting → $DEST"
say "✓ Installed autoloop-vision    → $VISION_DEST"
say "✓ Installed autoloop           → $LOOP_DEST"
say "  • Restart Claude Code (or start a new session) to load the three skills."
say "  • Mint a key in the Autoloop app → API keys, then:  export AUTOLOOP_API_KEY=…"
say "  • Initialize a loop:  node \"$DEST/autoloop.mjs\" init --team <teamId> --project <slug>"
