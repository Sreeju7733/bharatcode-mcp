# bharatcode-mcp

Install and manage MCP servers for BharatCode CLI and Desktop.

Run `npx bharatcode-mcp init --preset core` and never hand-edit JSON again.

## What it is

A local offline-first installer for Model Context Protocol (MCP) servers. It provides a curated registry, safe configuration merging with rolling backups, and a doctor command that checks that servers start properly.

## What it is not

Not a hosted service, not a web interface, not an authentication provider, not a telemetry collector, and not an auto-updater. Everything executes locally on your machine and all actions are reversible.

## Quickstart

```bash
npx bharatcode-mcp init --preset core --yes
npx bharatcode-mcp doctor
```

## Presets

- `core`: git, filesystem, local-docs
- `fullstack`: git, filesystem, postgres, local-docs
- `browser`: git, playwright, local-docs
- `data`: postgres

## Commands Reference

- `init`: Setup servers from presets or explicit server lists
- `add <server>`: Add a specific server from registry
- `remove <server>`: Remove a server managed by this CLI
- `list`: Show registry and installed servers
- `doctor`: Validate configured servers

## Config Files

- Linux/macOS: `${XDG_CONFIG_HOME:-~/.config}/bharatcode/bharatcode.json`
- Windows: `%APPDATA%\bharatcode\bharatcode.json`
- Local: `./bharatcode.json`

## Schema Support

- OpenCode format: `mcp` root property
- Claude Desktop format: `mcpServers` root property

## License

MIT
