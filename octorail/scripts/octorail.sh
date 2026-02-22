#!/usr/bin/env bash
set -euo pipefail

OCTORAIL_DIR="$HOME/.octorail"
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
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

# Self-install: symlink to ~/.local/bin/octorail
BIN_DIR="$HOME/.local/bin"
BIN_LINK="$BIN_DIR/octorail"
if [ ! -L "$BIN_LINK" ] || [ "$(readlink "$BIN_LINK")" != "$SCRIPT_DIR/octorail.sh" ]; then
  mkdir -p "$BIN_DIR"
  ln -sf "$SCRIPT_DIR/octorail.sh" "$BIN_LINK"
fi

exec node "$CLI_DST" "$@"
