# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-25

### Added
- `init` command with presets: `core`, `fullstack`, `browser`, `data`.
- `add`, `remove`, `list`, `doctor` subcommands.
- Config auto-detection (OpenCode vs Claude schema).
- Atomic write with 5-deep backup rotation.
- `doctor` verifies each server starts; supports `--json` and `--fix`.
- `--dry-run` on all write commands.
- One-liner install scripts for Linux/macOS and Windows.

### Security
- Never writes secrets into `bharatcode.json` without explicit `.env` opt-in.
- Backups created before every config mutation.
