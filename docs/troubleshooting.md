# Troubleshooting

## `doctor` says `MISSING_BINARY`

The server's runtime isn't installed.

| Runtime | Install |
|---|---|
| `uvx` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| `npx` | Install Node.js 20+ |
| `docker` | Install Docker Desktop or Docker Engine |

Then re-run `npx bharatcode-mcp doctor`.

## `doctor` says `MISSING_ENV`

The server needs an environment variable that isn't set.

```bash
export POSTGRES_URL="postgresql://user:pass@localhost:5432/db"
npx bharatcode-mcp add postgres
```

If you chose `.env` mode during init, check that `.env` exists in the project root.

## Agent doesn't see the tools after init

Restart the app. `bharatcode-cli` and `bharatcode-desktop` load MCP config at startup. They don't watch the file for changes.

Check the config path: `npx bharatcode-mcp list --installed` prints which file was written.

If you wrote to the global path but run bharatcode from a directory that has its own `bharatcode.json`, the local file wins. Use `--local` to write to the project file.

## Agent ignores the tools even though doctor says OK

The agent decides whether to call a tool. Be explicit:

❌ "What's in src/auth.ts?"

✅ "Use the filesystem tool to read src/auth.ts and summarize it."

Namedropping the server (git, filesystem, postgres) is a strong hint that works in every client.

## Schema mismatch

If init wrote the wrong format (e.g., you use Claude Desktop but it wrote OpenCode format):

```bash
npx bharatcode-mcp init --preset core --schema=claude --yes
```

The backup from the previous run is still on disk as `bharatcode.json.bak-*`.

## Config file is corrupted

```bash
# List backups
ls -la ~/.config/bharatcode/bharatcode.json.bak-*

# Restore the most recent
cp ~/.config/bharatcode/bharatcode.json.bak-2026-11-25T10-30-00-1 ~/.config/bharatcode/bharatcode.json
```
