#!/usr/bin/env bash
set -euo pipefail

OCTORAIL_DIR="$HOME/.octorail"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_SRC="$SCRIPT_DIR/cli.mjs"
CLI_DST="$OCTORAIL_DIR/cli.mjs"

# Bootstrap: install deps if missing
if [ ! -d "$OCTORAIL_DIR/node_modules/viem" ]; then
  mkdir -p "$OCTORAIL_DIR"
  cat > "$OCTORAIL_DIR/package.json" <<'PKGJSON'
{"private":true,"type":"module","dependencies":{"viem":"^2","@x402/fetch":"latest","@x402/evm":"latest"}}
PKGJSON
  npm install --prefix "$OCTORAIL_DIR" 1>&2
fi

# Copy cli.mjs if new or changed
if [ ! -f "$CLI_DST" ] || ! cmp -s "$CLI_SRC" "$CLI_DST"; then
  cp "$CLI_SRC" "$CLI_DST"
fi

exec node "$CLI_DST" "$@"
