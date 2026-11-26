import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeMcpConfig, removeMcpServer, inferIndent, MANAGED_BY_KEY, MANAGED_BY_VALUE } from "../src/writer.js";
import { fsOps } from "../src/fs-utils.js";
import type { ServerSpec } from "../src/types.js";

const dummyGitSpec: ServerSpec = {
  description: "Git repo inspection",
  runtime: "uvx",
  command: "uvx",
  args: ["mcp-server-git", "--repository", "."],
  requiredEnv: [],
  optionalEnv: [],
};

describe("writer", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bharatcode-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, "bharatcode.json");
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  it("preserves unrelated top-level keys byte-for-byte in structure", () => {
    const initialConfig = {
      theme: "dark",
      model: "bharatcode-deepseek-r1",
      settings: {
        fontSize: 14,
        telemetry: false,
      },
    };
    writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf-8");

    mergeMcpConfig(
      configPath,
      { git: dummyGitSpec },
      { schema: "opencode" }
    );

    const updated = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(updated.theme).toBe("dark");
    expect(updated.model).toBe("bharatcode-deepseek-r1");
    expect(updated.settings).toEqual({ fontSize: 14, telemetry: false });
    expect(updated.mcp.git).toBeDefined();
    expect(updated.mcp.git.type).toBe("local");
  });

  it("preserves unrelated mcp entries", () => {
    const initialConfig = {
      mcp: {
        customServer: {
          type: "local",
          command: ["my-custom-mcp"],
          enabled: true,
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf-8");

    mergeMcpConfig(
      configPath,
      { git: dummyGitSpec },
      { schema: "opencode" }
    );

    const updated = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(updated.mcp.customServer).toBeDefined();
    expect(updated.mcp.customServer.command).toEqual(["my-custom-mcp"]);
    expect(updated.mcp.git).toBeDefined();
  });

  it("idempotent second run -> identical output, changed: false", () => {
    const result1 = mergeMcpConfig(
      configPath,
      { git: dummyGitSpec },
      { schema: "opencode" }
    );
    expect(result1.changed).toBe(true);
    const contentAfterFirst = readFileSync(configPath, "utf-8");

    const result2 = mergeMcpConfig(
      configPath,
      { git: dummyGitSpec },
      { schema: "opencode" }
    );
    expect(result2.changed).toBe(false);
    const contentAfterSecond = readFileSync(configPath, "utf-8");
    expect(contentAfterSecond).toBe(contentAfterFirst);
  });

  it("creates backup; 6th run keeps only 5 backups", () => {
    writeFileSync(configPath, JSON.stringify({ version: 1 }), "utf-8");

    for (let i = 0; i < 6; i++) {
      mergeMcpConfig(
        configPath,
        {
          git: {
            ...dummyGitSpec,
            args: [`--arg-${i}`],
          },
        },
        { schema: "opencode" }
      );
    }

    const files = readdirSync(testDir);
    const backups = files.filter((f) => f.startsWith("bharatcode.json.bak-"));
    expect(backups.length).toBe(5);
  });

  it("atomic write: mock fsOps.renameSync to throw -> original file intact", () => {
    const initialContent = JSON.stringify({ original: true }, null, 2) + "\n";
    writeFileSync(configPath, initialContent, "utf-8");

    const renameSpy = vi.spyOn(fsOps, "renameSync").mockImplementation(() => {
      throw new Error("Disk error during rename");
    });

    expect(() => {
      mergeMcpConfig(
        configPath,
        { git: dummyGitSpec },
        { schema: "opencode" }
      );
    }).toThrow("Atomic write failed");

    renameSpy.mockRestore();
    const finalContent = readFileSync(configPath, "utf-8");
    expect(finalContent).toBe(initialContent);
  });

  it("corrupt existing file -> backup restored, typed error thrown", () => {
    writeFileSync(configPath, "{ invalid json content", "utf-8");

    expect(() => {
      mergeMcpConfig(
        configPath,
        { git: dummyGitSpec },
        { schema: "opencode" }
      );
    }).toThrow("Failed to parse existing config");
  });

  it("--dry-run -> no disk write, diff returned", () => {
    const initialConfig = { initial: "value" };
    writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf-8");

    const result = mergeMcpConfig(
      configPath,
      { git: dummyGitSpec },
      { schema: "opencode", dryRun: true }
    );

    expect(result.changed).toBe(true);
    expect(result.diff).toContain("+");
    expect(result.diff).toContain("git");

    const diskContent = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(diskContent.mcp).toBeUndefined();
  });

  it("opencode vs claude format shapes", () => {
    const opencodePath = join(testDir, "opencode.json");
    mergeMcpConfig(
      opencodePath,
      { git: dummyGitSpec },
      { schema: "opencode" }
    );
    const opencodeConfig = JSON.parse(readFileSync(opencodePath, "utf-8"));
    expect(opencodeConfig.mcp).toBeDefined();
    expect(opencodeConfig.mcp.git.type).toBe("local");
    expect(opencodeConfig.mcp.git.command).toEqual(["uvx", "mcp-server-git", "--repository", "."]);
    expect(opencodeConfig.mcp.git.enabled).toBe(true);
    expect(opencodeConfig.mcp.git[MANAGED_BY_KEY]).toBe(MANAGED_BY_VALUE);

    const claudePath = join(testDir, "claude.json");
    mergeMcpConfig(
      claudePath,
      { git: dummyGitSpec },
      { schema: "claude" }
    );
    const claudeConfig = JSON.parse(readFileSync(claudePath, "utf-8"));
    expect(claudeConfig.mcpServers).toBeDefined();
    expect(claudeConfig.mcpServers.git.command).toBe("uvx");
    expect(claudeConfig.mcpServers.git.args).toEqual(["mcp-server-git", "--repository", "."]);
    expect(claudeConfig.mcpServers.git[MANAGED_BY_KEY]).toBe(MANAGED_BY_VALUE);
  });

  it("removeMcpServer removes managed server and preserves unmanaged", () => {
    mergeMcpConfig(
      configPath,
      { git: dummyGitSpec },
      { schema: "opencode" }
    );

    const current = JSON.parse(readFileSync(configPath, "utf-8"));
    current.mcp.manual = { type: "local", command: ["manual-srv"], enabled: true };
    writeFileSync(configPath, JSON.stringify(current, null, 2), "utf-8");

    const removeRes = removeMcpServer(configPath, "git");
    expect(removeRes.changed).toBe(true);

    const updated = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(updated.mcp.git).toBeUndefined();
    expect(updated.mcp.manual).toBeDefined();

    expect(() => {
      removeMcpServer(configPath, "manual");
    }).toThrow("was not managed by bharatcode-mcp");
  });

  it("inferIndent recognizes tabs and 4 spaces", () => {
    expect(inferIndent("{\n\t\"key\": true\n}")).toBe("\t");
    expect(inferIndent("{\n    \"key\": true\n}")).toBe(4);
    expect(inferIndent("{\n  \"key\": true\n}")).toBe(2);
  });
});

describe("writer branch coverage", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bharatcode-writer-branch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("removes server from claude mcpServers configuration", () => {
    const claudePath = join(testDir, "claude-remove.json");
    mergeMcpConfig(claudePath, { git: dummyGitSpec }, { schema: "claude" });
    const res = removeMcpServer(claudePath, "git", { schema: "claude" });
    expect(res.changed).toBe(true);
    const updated = JSON.parse(readFileSync(claudePath, "utf-8"));
    expect(updated.mcpServers.git).toBeUndefined();
  });

  it("handles remove dryRun option", () => {
    const p = join(testDir, "dry-remove.json");
    mergeMcpConfig(p, { git: dummyGitSpec }, { schema: "opencode" });
    const res = removeMcpServer(p, "git", { dryRun: true });
    expect(res.changed).toBe(true);
    expect(res.diff).toBeDefined();
    const disk = JSON.parse(readFileSync(p, "utf-8"));
    expect(disk.mcp.git).toBeDefined();
  });

  it("throws when remove target file does not exist", () => {
    expect(() => removeMcpServer(join(testDir, "nonexistent.json"), "git")).toThrow("does not exist");
  });

  it("handles custom env variables in opencode and claude formats", () => {
    const pOpencode = join(testDir, "env-opencode.json");
    mergeMcpConfig(pOpencode, {
      postgres: {
        description: "Postgres",
        runtime: "npx",
        command: "npx",
        args: ["@modelcontextprotocol/server-postgres"],
        requiredEnv: ["POSTGRES_URL"],
        optionalEnv: [],
        env: { POSTGRES_URL: "postgresql://localhost/db" },
      },
    }, { schema: "opencode" });

    const opencodeContent = JSON.parse(readFileSync(pOpencode, "utf-8"));
    expect(opencodeContent.mcp.postgres.environment.POSTGRES_URL).toBe("postgresql://localhost/db");

    const pClaude = join(testDir, "env-claude.json");
    mergeMcpConfig(pClaude, {
      postgres: {
        description: "Postgres",
        runtime: "npx",
        command: "npx",
        args: ["@modelcontextprotocol/server-postgres"],
        requiredEnv: ["POSTGRES_URL"],
        optionalEnv: [],
        env: { POSTGRES_URL: "postgresql://localhost/db" },
      },
    }, { schema: "claude" });

    const claudeContent = JSON.parse(readFileSync(pClaude, "utf-8"));
    expect(claudeContent.mcpServers.postgres.env.POSTGRES_URL).toBe("postgresql://localhost/db");
  });
});
