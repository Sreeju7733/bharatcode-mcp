import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../src/cli.js";

describe("cli", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bharatcode-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, "bharatcode.json");
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  it("init --preset core --yes --path <tmp> -> expected config", async () => {
    const cli = createCli();
    cli.exitOverride();

    await cli.parseAsync([
      "node",
      "bharatcode-mcp",
      "init",
      "--preset",
      "core",
      "--yes",
      "--path",
      configPath,
    ]);

    expect(existsSync(configPath)).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.mcp).toBeDefined();
    expect(content.mcp.git).toBeDefined();
    expect(content.mcp.filesystem).toBeDefined();
    expect(content.mcp["local-docs"]).toBeDefined();
  });

  it("add postgres with --yes and no env -> exits 1 with missing env error", async () => {
    const cli = createCli();
    cli.exitOverride();

    const originalEnv = process.env.POSTGRES_URL;
    delete process.env.POSTGRES_URL;

    try {
      await expect(
        cli.parseAsync([
          "node",
          "bharatcode-mcp",
          "add",
          "postgres",
          "--yes",
          "--path",
          configPath,
        ])
      ).rejects.toThrow();
    } finally {
      if (originalEnv) process.env.POSTGRES_URL = originalEnv;
    }
  });

  it("list --installed --json -> valid JSON snapshot", async () => {
    const cli = createCli();
    cli.exitOverride();

    // Prepare a config
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          git: { type: "local", command: ["uvx", "mcp-server-git"], enabled: true },
        },
      })
    );

    let output = "";
    const logSpy = vi.spyOn(console, "log").mockImplementation((str) => {
      output += str;
    });

    await cli.parseAsync([
      "node",
      "bharatcode-mcp",
      "list",
      "--installed",
      "--json",
      "--path",
      configPath,
    ]);

    logSpy.mockRestore();
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe("git");
    expect(parsed[0].installed).toBe(true);
  });

  it("remove unknown server -> exits with error", async () => {
    const cli = createCli();
    cli.exitOverride();

    writeFileSync(configPath, JSON.stringify({ mcp: {} }));

    await expect(
      cli.parseAsync([
        "node",
        "bharatcode-mcp",
        "remove",
        "nonexistent-server",
        "--path",
        configPath,
      ])
    ).rejects.toThrow();
  });
});
