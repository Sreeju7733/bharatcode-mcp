# Architecture & Technical Design

`bharatcode-mcp` is designed to be an offline-first, local installer for Model Context Protocol (MCP) servers.

## Design Principles

1. **Zero Telemetry**: No tracking, phone-home, or third-party analytical requests.
2. **Deterministic & Idempotent**: Running `init` multiple times produces byte-identical configurations.
3. **Safe Writes**: Never corrupts an existing configuration file.

## Configuration Flow

```
[User Command: init / add / remove]
       │
       ▼
[detectRuntimes & detectSchema] ─── Auto-detects runtime (node/npx, uvx, docker)
       │                            and target schema (OpenCode `mcp` vs Claude `mcpServers`)
       ▼
[Backup Manager] ────────────────── Creates `bharatcode.json.bak-<ISO8601>-<id>`
       │                            Preserves up to 5 rolling backups; deletes older.
       ▼
[Deep Merge & Format] ───────────── Merges new server blocks while preserving unrelated
       │                            keys byte-for-byte.
       ▼
[Atomic Write] ──────────────────── Writes to `<path>.tmp` -> fsync() -> rename().
       │
       ▼
[Post-Write Validation] ─────────── Parses file back and validates schema using Zod.
       │                            Restores backup immediately if validation fails.
       ▼
[Doctor Verification] ───────────── Verifies binaries via `--version` or runs stdio
                                    JSON-RPC `initialize` handshake.
```

## Schema Compatibility

- **OpenCode Format** (used by `bharatcode-cli` and `bharatcode-desktop`):
  ```json
  {
    "mcp": {
      "git": {
        "type": "local",
        "command": ["uvx", "mcp-server-git", "--repository", "."],
        "enabled": true,
        "__managedBy": "bharatcode-mcp"
      }
    }
  }
  ```

- **Claude Format** (used by Claude Desktop and Cursor):
  ```json
  {
    "mcpServers": {
      "git": {
        "command": "uvx",
        "args": ["mcp-server-git", "--repository", "."],
        "__managedBy": "bharatcode-mcp"
      }
    }
  }
  ```
