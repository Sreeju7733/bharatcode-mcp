# Security Policy

## Supported versions

Only the latest `v1.x` line receives security fixes.

| Version | Supported |
|---|---|
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository:
https://github.com/BharatCode-ai/bharatcode-mcp/security/advisories/new

Or email the maintainers directly (see `package.json` for contact). Expect an initial response within 72 hours. We will coordinate a disclosure date with you and credit reporters who want it.

## Scope

In scope:
- Credential handling (the CLI must never write secrets to config files without explicit opt-in)
- Backup and restore correctness (a failed write must not corrupt the user's config)
- Dependency vulnerabilities in `package.json`

Out of scope:
- The behavior of upstream MCP servers (report those to their maintainers)
- LLM output quality (this tool installs servers; it does not review code)
