# Adding a Server to the Registry

The registry is `registry/servers.json`. Every server entry has the same shape.

## Schema

```json
{
  "description": "One sentence describing what this server does.",
  "runtime": "npx | uvx | docker | binary",
  "command": "npx",
  "args": ["-y", "@scope/package-name"],
  "requiredEnv": ["SOME_API_KEY"],
  "optionalEnv": ["OPTIONAL_FLAG"]
}
```

## Steps

1. Verify the server starts locally.
   ```bash
   npx -y @scope/package-name --version
   # or
   uvx mcp-server-name --version
   ```
   If it hangs or errors, fix that before adding it.

2. Add the entry to `registry/servers.json`.

3. Add it to a preset (or leave it out — users can still add it by name).

4. Test the full flow.
   ```bash
   npm run build
   node dist/cli.js init --servers your-server --path /tmp/test.json --dry-run
   node dist/cli.js add your-server --path /tmp/test.json
   node dist/cli.js doctor --json
   ```

5. Add a test in `tests/registry.test.ts`:
   ```ts
   it("parses the your-server entry", () => {
     const registry = loadRegistry();
     expect(registry.servers["your-server"]).toBeDefined();
     expect(registry.servers["your-server"].runtime).toBe("npx");
   });
   ```

6. Update `README.md` if the server is added to a preset (the preset table must match `servers.json`).

## Guidelines

- `requiredEnv` must be truly required. If the server works without it, use `optionalEnv`.
- Never put secrets in `args`. Use `requiredEnv` so the CLI prompts for them.
- Pin versions where possible (`@scope/package@1.2.3` not `@latest`) unless the upstream has no stable release.
- Test on Linux, macOS, and Windows. A server that only works on macOS breaks users on Windows.
