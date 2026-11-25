# MCP Presets Reference

BharatCode MCP includes curated presets to configure servers based on typical development workflows.

## Preset Catalog

### `core`
The default preset for any standard project.
- **Included servers**: `git`, `filesystem`, `local-docs`
- **Use case**: Local repository diffs, file searches, reading docs and specs.
- **Required env**: None.

```bash
npx bharatcode-mcp init --preset core
```

### `fullstack`
Complete preset for full-stack and web applications.
- **Included servers**: `git`, `filesystem`, `postgres`, `local-docs`
- **Use case**: Source inspection, schema inspection, read-only SQL querying.
- **Required env**: `POSTGRES_URL`

```bash
npx bharatcode-mcp init --preset fullstack
```

### `browser`
Preset tailored for UI testing, scraping, and web automation.
- **Included servers**: `git`, `playwright`, `local-docs`
- **Use case**: Headless browser automation and accessibility tree snapshots.
- **Required env**: None.

```bash
npx bharatcode-mcp init --preset browser
```

### `data`
Lightweight preset for database administration and querying.
- **Included servers**: `postgres`
- **Use case**: Database inspection and querying without filesystem tools.
- **Required env**: `POSTGRES_URL`

```bash
npx bharatcode-mcp init --preset data
```

## Adding Individual Servers

You can install individual servers alongside or outside presets using `add`:

```bash
npx bharatcode-mcp add playwright
```
