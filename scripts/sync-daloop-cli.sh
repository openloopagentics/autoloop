#!/usr/bin/env bash
# Resync the canonical daloop CLI (cli/daloop.mjs) into its distribution copies:
#   - web/public/skill/daloop.mjs        (website curl installer)
#   - plugins/daloop-reporting/bin/daloop (Claude Code plugin, on $PATH)
# Run after editing cli/daloop.mjs. (web also resyncs via its `prebuild` step.)
set -euo pipefail
cd "$(dirname "$0")/.."

cp cli/daloop.mjs web/public/skill/daloop.mjs
cp cli/daloop.mjs plugins/daloop-reporting/bin/daloop
chmod +x plugins/daloop-reporting/bin/daloop
cp cli/vision-schema.mjs plugins/daloop-reporting/bin/vision-schema.mjs
chmod +x plugins/daloop-reporting/bin/vision-schema.mjs

echo "✓ synced cli/daloop.mjs → web/public/skill/daloop.mjs, plugins/daloop-reporting/bin/daloop"
echo "✓ synced cli/vision-schema.mjs → plugins/daloop-reporting/bin/vision-schema.mjs"
