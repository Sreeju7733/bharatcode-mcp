#!/usr/bin/env bash
set -euo pipefail

PRESET="${1:-core}"

if ! command -v npx >/dev/null 2>&1; then
  echo "error: Node.js 20+ is required." >&2
  echo "Install via: nvm, fnm, or https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "error: Node.js 20+ required (found $(node --version 2>/dev/null || echo none))." >&2
  exit 1
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "Installing uv for Python-based MCP servers..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
fi

npx -y bharatcode-mcp@latest init --preset "${PRESET}" --yes
npx -y bharatcode-mcp@latest doctor
