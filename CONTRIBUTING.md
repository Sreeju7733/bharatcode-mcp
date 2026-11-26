# Contributing to bharatcode-mcp

## Development setup

```bash
git clone https://github.com/BharatCode-ai/bharatcode-mcp
cd bharatcode-mcp
npm install
npm run build
npm test
```

## Project layout

| Directory | What lives here |
|---|---|
| `src/` | TypeScript source. `cli.ts` is the entrypoint. |
| `registry/` | `servers.json` — the curated server catalog. |
| `scripts/` | Install scripts (`install.sh`, `install.ps1`). |
| `tests/` | Vitest tests. `fixtures/` has sample configs. |
| `dist/` | Bundled output. Committed — CI fails if stale. |

## Before opening a PR

```bash
npm run typecheck
npm run lint
npm test -- --coverage
npm run build
git add dist/
```

CI runs the same commands. The `git diff --exit-code dist/` step fails if `dist/` is out of date.

## Adding a server to the registry

See [docs/adding-servers.md](docs/adding-servers.md). Short version:
1. Add an entry to `registry/servers.json`.
2. Run `npx bharatcode-mcp doctor` against a test config to verify it starts.
3. Add a test in `tests/registry.test.ts` asserting the entry parses.

## Commit style

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). One line on why: the CHANGELOG is generated from commits.

## Release process (maintainers)

1. Update `CHANGELOG.md`: move `[Unreleased]` items to a new `[x.y.z]` section with today's date.
2. `npm version patch|minor|major`
3. `git push origin main --tags`
4. `git tag -f v1 && git push -f origin v1` (floating major tag)
5. Create GitHub release from the tag.
6. `npm publish --provenance --access public`
