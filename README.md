# bharatcode-mcp

[![CI](https://github.com/BharatCode-ai/bharatcode-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/BharatCode-ai/bharatcode-mcp/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/bharatcode-mcp.svg)](https://www.npmjs.com/package/bharatcode-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight CLI that installs and configures Model Context Protocol (MCP) servers into BharatCode configurations.

Running `npx bharatcode-mcp init --preset core` generates or merges a validated configuration with the core MCP servers (`git`, `filesystem`, `local-docs`), backs up any existing configuration file, and verifies that each server runtime starts correctly on your system.

---

## What it does

- Installs curated MCP servers into `bharatcode-cli` and `bharatcode-desktop` config files.
- Presets: `core`, `fullstack`, `browser`, `data` — one command, multiple servers.
- Safe merge: backs up existing config before writing, preserves unrelated keys.
- Doctor: verifies every installed server actually starts.
- Idempotent: running `init` twice produces the same result.

## Requirements

- Node.js 20 or later
- `npx` (comes with Node)
- (Optional) `uvx` for Python-based servers (the `git` server needs this)
- (Optional) `docker` for containerized servers

## Quickstart

```bash
# One command — installs core preset, verifies servers
npx bharatcode-mcp init --preset core

# Check what was installed
npx bharatcode-mcp list --installed

# Verify everything starts
npx bharatcode-mcp doctor
```

Then restart bharatcode-cli or bharatcode-desktop. The agent will see the new tools.

## Presets

| Preset | Servers included |
|---|---|
| `core` | git, filesystem, local-docs |
| `fullstack` | git, filesystem, postgres, local-docs |
| `browser` | git, playwright, local-docs |
| `data` | postgres |

## Commands

### `init`

Install a preset or a comma-separated list of servers.

```bash
npx bharatcode-mcp init --preset core
npx bharatcode-mcp init --servers git,filesystem
npx bharatcode-mcp init --preset fullstack --path ./bharatcode.json
```

Flags:
- `--preset <name>` — preset name to install (`core`, `fullstack`, `browser`, `data`)
- `--servers <list>` — comma-separated list of server names to install
- `--global` — write to global config path
- `--local` — write to local bharatcode.json in current directory
- `--path <file>` — explicit path to configuration file (default: detect)
- `--schema <format>` — config format: `auto`, `opencode`, `claude` (default: auto-detect from installed binary)
- `--yes` — non-interactive (fails if requiredEnv missing)
- `--dry-run` — print the diff, write nothing
- `--json` — output results in JSON format

### `add <server>`

Add one server. Prompts only for that server's required env vars.

```bash
npx bharatcode-mcp add postgres
```

Flags:
- `--global` — write to global config path
- `--local` — write to local bharatcode.json in current directory
- `--path <file>` — explicit path to configuration file
- `--schema <format>` — config format: `auto`, `opencode`, `claude`
- `--yes` — non-interactive
- `--dry-run` — print the diff, write nothing
- `--json` — output results in JSON format

### `remove <server>`

Remove a server that was installed by this tool.

```bash
npx bharatcode-mcp remove git
```

Flags:
- `--global` — remove from global config path
- `--local` — remove from local bharatcode.json in current directory
- `--path <file>` — explicit path to configuration file
- `--dry-run` — preview changes without modifying disk
- `--json` — output results in JSON format

### `list`

Show available and installed servers.

```bash
npx bharatcode-mcp list
npx bharatcode-mcp list --installed
npx bharatcode-mcp list --json
```

Flags:
- `--installed` — show only installed servers in active configuration
- `--preset <name>` — filter by preset
- `--path <file>` — configuration file to inspect for installed status
- `--json` — output results in JSON format

### `doctor`

Verify each configured server starts.

```bash
npx bharatcode-mcp doctor
npx bharatcode-mcp doctor --json
```

Flags:
- `--path <file>` — configuration file to verify
- `--fix` — offer runtime installation fixes for broken servers
- `--json` — output raw verification results in JSON format

Example output:

```text
MCP Doctor Verification for /tmp/bharatcode.json

SERVER           STATUS             DETAIL
--------------------------------------------------------------------------------
git              OK                 Binary verified and responsive
filesystem       OK                 Binary verified and responsive
postgres         MISSING_ENV        Missing required environment variable(s): POSTGRES_URL. Action: Define POSTGRES_URL in your environment or .env file.
playwright       OK                 Binary verified and responsive
```

## Where it writes

| Platform | Global config | Local config |
|---|---|---|
| Linux | `${XDG_CONFIG_HOME:-~/.config}/bharatcode/bharatcode.json` | `./bharatcode.json` |
| macOS | `${XDG_CONFIG_HOME:-~/.config}/bharatcode/bharatcode.json` | `./bharatcode.json` |
| Windows | `%APPDATA%\bharatcode\bharatcode.json` | `.\bharatcode.json` |

Backups: every write creates `bharatcode.json.bak-<timestamp>-<id>`. The last 5 are kept.

Idempotent: running the same command twice produces a byte-identical file.

## Schema compatibility

BharatCode CLI and Desktop derive from OpenCode, which uses the `mcp` key format. If you also use Claude Desktop or Cursor, they use `mcpServers`. The CLI auto-detects which format the installed binary reads. Override with `--schema`.

| Format | Key | Used by |
|---|---|---|
| OpenCode | `mcp` | bharatcode-cli, bharatcode-desktop |
| Claude | `mcpServers` | Claude Desktop, Cursor |

## Security

Never writes secrets into `bharatcode.json`. Env values are prompted at install time and written only if you choose the `.env` option. Otherwise you get a `export KEY=value` line to add to your shell.

Backups before every write. Restore with `cp bharatcode.json.bak-<timestamp> bharatcode.json`.

No telemetry. No data leaves your machine except when the MCP servers themselves call external APIs.

Report vulnerabilities via [SECURITY.md](SECURITY.md).

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md) for:
- `doctor` says `MISSING_BINARY` — what to install
- `doctor` says `MISSING_ENV` — how to set env vars
- Agent doesn't see the tools after init — restart the app
- Schema mismatch symptoms

## Adding your own server

See [docs/adding-servers.md](docs/adding-servers.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
