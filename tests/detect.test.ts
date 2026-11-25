import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve, join } from "node:path";
import {
  detectRuntimes,
  resolveConfigPaths,
  detectSchema,
  clearRuntimeCache,
} from "../src/detect.js";
import { cpOps } from "../src/cp-utils.js";
import { fsOps } from "../src/fs-utils.js";

describe("detect", () => {
  beforeEach(() => {
    clearRuntimeCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearRuntimeCache();
    vi.restoreAllMocks();
  });

  it("detects runtimes and handles missing binary", async () => {
    vi.spyOn(cpOps, "execSync").mockImplementation((cmd: any) => {
      const commandStr = String(cmd);
      if (commandStr.includes("which npx") || commandStr.includes("where npx")) {
        throw new Error("Command failed");
      }
      if (commandStr.includes("which node") || commandStr.includes("where node")) {
        return "/usr/bin/node";
      }
      if (commandStr.includes("node --version")) {
        return "v20.0.0";
      }
      throw new Error("not found");
    });

    const status = await detectRuntimes();
    expect(status.npx.present).toBe(false);
    expect(status.node.present).toBe(true);
    expect(status.node.version).toBe("v20.0.0");
  });

  it("XDG_CONFIG_HOME is respected on non-win32 platforms", () => {
    const originalXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = "/custom/config";
      const paths = resolveConfigPaths({ global: true, platform: "linux" });
      expect(paths[0]).toBe("/custom/config/bharatcode/bharatcode.json");
    } finally {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
  });

  it("%APPDATA% is respected on win32", () => {
    const originalAppData = process.env.APPDATA;
    try {
      process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming";
      const paths = resolveConfigPaths({ global: true, platform: "win32" });
      expect(paths[0]).toBe("C:\\Users\\Test\\AppData\\Roaming\\bharatcode\\bharatcode.json");
    } finally {
      process.env.APPDATA = originalAppData;
    }
  });

  it("--schema=claude overrides binary probe", async () => {
    const detected = await detectSchema("/some/bin/bharatcode", "claude");
    expect(detected.format).toBe("claude");
    expect(detected.source).toBe("user-flag");
  });

  it("detects schema from binary --version probe", async () => {
    vi.spyOn(cpOps, "execSync").mockImplementation((cmd: any) => {
      const commandStr = String(cmd);
      if (commandStr.includes("--version")) {
        return "Claude Desktop CLI v1.2";
      }
      return "/usr/bin/claude";
    });

    const detected = await detectSchema("claude");
    expect(detected.format).toBe("claude");
    expect(detected.source).toBe("binary-probe");
  });

  it("detects schema from source inspect if binary probe is inconclusive", async () => {
    vi.spyOn(cpOps, "execSync").mockImplementation((cmd: any) => {
      const commandStr = String(cmd);
      if (commandStr.includes("--version")) {
        return "unknown tool";
      }
      return "/fake/path/bin";
    });
    vi.spyOn(fsOps, "existsSync").mockReturnValue(true);
    vi.spyOn(fsOps, "readFileSync").mockReturnValue('const config = { "mcpServers": {} };');

    const detected = await detectSchema("/fake/path/bin");
    expect(detected.format).toBe("claude");
    expect(detected.source).toBe("source-inspect");
  });

  it("falls back to opencode schema", async () => {
    const detected = await detectSchema();
    expect(detected.format).toBe("opencode");
    expect(detected.source).toBe("fallback");
  });
});
describe("detect extra paths and schemas", () => {
  it("detects schema from opencode binary probe", async () => {
    vi.spyOn(cpOps, "execSync").mockImplementation((cmd: any) => {
      const commandStr = String(cmd);
      if (commandStr.includes("--version")) {
        return "bharatcode 1.0";
      }
      return "/usr/bin/bharatcode";
    });

    const detected = await detectSchema("bharatcode");
    expect(detected.format).toBe("opencode");
    expect(detected.source).toBe("binary-probe");
  });

  it("detects schema from source inspect with mcp key", async () => {
    vi.spyOn(cpOps, "execSync").mockImplementation((cmd: any) => {
      const commandStr = String(cmd);
      if (commandStr.includes("--version")) {
        return "unknown tool";
      }
      return "/fake/path/bin2";
    });
    vi.spyOn(fsOps, "existsSync").mockReturnValue(true);
    vi.spyOn(fsOps, "readFileSync").mockReturnValue('const config = { "mcp": {} };');

    const detected = await detectSchema("/fake/path/bin2");
    expect(detected.format).toBe("opencode");
    expect(detected.source).toBe("source-inspect");
  });

  it("resolveConfigPaths handles explicit local flag", () => {
    const paths = resolveConfigPaths({ local: true, cwd: "/my/proj" });
    expect(paths[0]).toBe(resolve("/my/proj", "bharatcode.json"));
  });
});
describe("detect branch coverage", () => {
  it("resolves candidates when file exists on disk", () => {
    vi.spyOn(fsOps, "existsSync").mockImplementation((p: any) => String(p).endsWith("bharatcode.json"));
    const paths = resolveConfigPaths();
    expect(paths.length).toBeGreaterThan(0);
  });

  it("handles explicit path option in resolveConfigPaths", () => {
    const paths = resolveConfigPaths({ path: "custom/path.json", cwd: "/root" });
    expect(paths[0]).toBe(resolve("/root", "custom/path.json"));
  });
});
describe("detect additional branches", () => {
  it("resolves candidates when only global file exists", () => {
    vi.spyOn(fsOps, "existsSync").mockImplementation((p: any) => String(p).includes(".config"));
    const paths = resolveConfigPaths({ cwd: "/fake/dir" });
    expect(paths.length).toBe(1);
  });

  it("resolves binary probe with error fallback to source inspect", async () => {
    vi.spyOn(cpOps, "execSync").mockImplementation((cmd: any) => {
      const commandStr = String(cmd);
      if (commandStr.includes("where") || commandStr.includes("which")) {
        return "/custom/bin";
      }
      if (commandStr.includes("--version")) {
        throw new Error("version failed");
      }
      return "";
    });
    vi.spyOn(fsOps, "existsSync").mockReturnValue(true);
    vi.spyOn(fsOps, "readFileSync").mockReturnValue('const mcp = "mcp";');

    const detected = await detectSchema("/custom/bin");
    expect(detected.format).toBe("opencode");
    expect(detected.source).toBe("source-inspect");
  });
});
