import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { RuntimeStatus, DetectedSchema, SchemaFormat } from "./types.js";
import { cpOps } from "./cp-utils.js";
import { fsOps } from "./fs-utils.js";

let cachedRuntimes: RuntimeStatus | null = null;

export async function detectRuntimes(): Promise<RuntimeStatus> {
  if (cachedRuntimes) {
    return cachedRuntimes;
  }

  const checkCmd = (cmd: string): { present: boolean; version?: string } => {
    try {
      const isWin = process.platform === "win32";
      const lookup = isWin ? `where ${cmd}` : `which ${cmd}`;
      cpOps.execSync(lookup, { stdio: "ignore" });
      const versionOut = cpOps.execSync(`${cmd} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      }).toString().trim();
      return { present: true, version: versionOut };
    } catch {
      return { present: false };
    }
  };

  const status: RuntimeStatus = {
    node: checkCmd("node"),
    npx: checkCmd("npx"),
    uvx: checkCmd("uvx"),
    docker: checkCmd("docker"),
  };

  cachedRuntimes = status;
  return status;
}

export interface ResolveConfigOptions {
  path?: string;
  global?: boolean;
  local?: boolean;
  cwd?: string;
  platform?: string;
}

export function resolveConfigPaths(opts: ResolveConfigOptions = {}): string[] {
  const cwd = opts.cwd || process.cwd();

  if (opts.path) {
    return [resolve(cwd, opts.path)];
  }

  const isWin = (opts.platform || process.platform) === "win32";
  let globalPath: string;

  if (isWin) {
    const appData = process.env.APPDATA || resolve(homedir(), "AppData", "Roaming");
    const sep = "\\";
    globalPath = `${appData}${sep}bharatcode${sep}bharatcode.json`;
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || (opts.platform === "linux" ? `${homedir()}/.config` : join(homedir(), ".config"));
    const sep = opts.platform === "linux" ? "/" : (process.platform === "win32" ? "\\" : "/");
    globalPath = `${xdgConfig}${sep}bharatcode${sep}bharatcode.json`;
  }

  const localPath = resolve(cwd, "bharatcode.json");

  if (opts.global) {
    return [globalPath];
  }

  if (opts.local) {
    return [localPath];
  }

  const orderedCandidates: string[] = [];
  if (fsOps.existsSync(localPath)) {
    orderedCandidates.push(localPath);
  }
  if (fsOps.existsSync(globalPath)) {
    orderedCandidates.push(globalPath);
  }

  if (orderedCandidates.length > 0) {
    return orderedCandidates;
  }

  return [globalPath];
}

export async function detectSchema(
  binaryPath?: string,
  userFlag?: SchemaFormat
): Promise<DetectedSchema> {
  if (userFlag && userFlag !== "unknown") {
    return {
      format: userFlag,
      source: "user-flag",
    };
  }

  if (binaryPath) {
    try {
      const isWin = process.platform === "win32";
      const lookup = isWin ? `where ${binaryPath}` : `which ${binaryPath}`;
      let resolvedBin = binaryPath;
      try {
        const out = cpOps.execSync(lookup, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
        resolvedBin = out.toString().split("\n")[0].trim();
      } catch {
        // use original binaryPath
      }

      try {
        const verOutput = cpOps.execSync(`"${resolvedBin}" --version`, {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).toString().toLowerCase();

        if (verOutput.includes("claude")) {
          return { format: "claude", source: "binary-probe", path: resolvedBin };
        }
        if (verOutput.includes("opencode") || verOutput.includes("bharatcode")) {
          return { format: "opencode", source: "binary-probe", path: resolvedBin };
        }
      } catch {
        // version probe failed
      }

      if (fsOps.existsSync(resolvedBin)) {
        try {
          const content = fsOps.readFileSync(resolvedBin, "utf-8").toString();
          if (content.includes("mcpServers")) {
            return { format: "claude", source: "source-inspect", path: resolvedBin };
          }
          if (content.includes('"mcp"') || content.includes("'mcp'")) {
            return { format: "opencode", source: "source-inspect", path: resolvedBin };
          }
        } catch {
          // not text or cannot read
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    format: "opencode",
    source: "fallback",
  };
}

export function clearRuntimeCache(): void {
  cachedRuntimes = null;
}
