import { spawn } from "node:child_process";
import type { DoctorResult, DoctorStatus } from "./types.js";
import { cpOps } from "./cp-utils.js";

export interface RunDoctorOptions {
  timeoutMs?: number;
  fix?: boolean;
}

export interface DoctorTargetServer {
  name: string;
  command: string;
  args: string[];
  requiredEnv?: string[];
  env?: Record<string, string>;
  runtime?: string;
}

export function getResolutionTip(status: DoctorStatus, command: string, detail?: string): string {
  switch (status) {
    case "MISSING_BINARY":
      if (command === "uvx") {
        return "Install uv for Python MCP servers via: curl -LsSf https://astral.sh/uv/install.sh | sh";
      }
      if (command === "npx") {
        return "Install Node.js 20+ via: https://nodejs.org or nvm install 20";
      }
      if (command === "docker") {
        return "Install Docker Desktop or Docker engine and ensure it is running in PATH";
      }
      return `Ensure binary '${command}' is installed and present in your system PATH.`;
    case "MISSING_ENV":
      return "Define the missing environment variable in your shell (export KEY=...) or in a local .env file.";
    case "TIMEOUT":
      return "The server process timed out during initialization. Verify its command arguments, credentials, or network availability.";
    case "HANDSHAKE_FAILED":
      return "Server crashed or failed MCP stdio handshake. Check logs or test launching the command manually.";
    case "BAD_VERSION":
      return "Binary version is incompatible. Please update the binary to the latest recommended version.";
    default:
      return detail || "";
  }
}

export async function checkServerBinary(
  server: DoctorTargetServer,
  timeoutMs = 10000
): Promise<DoctorResult> {
  const { name, command, args, requiredEnv, env } = server;

  // 1. Check required environment variables
  if (requiredEnv && requiredEnv.length > 0) {
    const missing: string[] = [];
    for (const key of requiredEnv) {
      const val = (env && env[key]) || process.env[key];
      if (!val) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      const detail = `Missing required environment variable(s): ${missing.join(", ")}`;
      return {
        name,
        status: "MISSING_ENV",
        detail: `${detail}. Action: Define ${missing.join(", ")} in your environment or .env file.`,
      };
    }
  }

  // 2. Resolve command binary
  const isWin = process.platform === "win32";
  const lookupCmd = isWin ? `where ${command}` : `which ${command}`;
  try {
    cpOps.execSync(lookupCmd, { stdio: "ignore" });
  } catch {
    const tip = getResolutionTip("MISSING_BINARY", command);
    return {
      name,
      status: "MISSING_BINARY",
      detail: `Binary '${command}' is not found in PATH. Action: ${tip}`,
    };
  }

  // 3. Run <command> --version with timeout
  let versionWorked = false;
  try {
    const res = await new Promise<string>((resolve, reject) => {
      cpOps.exec(`"${command}" --version`, { timeout: timeoutMs }, (err: any, stdout: any) => {
        if (err) return reject(err);
        resolve(String(stdout || ""));
      });
    });
    if (res.trim().length > 0) {
      versionWorked = true;
    }
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.killed || err?.signal === "SIGTERM") {
      return {
        name,
        status: "TIMEOUT",
        detail: `Timed out after ${timeoutMs}ms while executing '${command} --version'. Action: Check server responsiveness.`,
      };
    }
  }

  if (versionWorked) {
    return {
      name,
      status: "OK",
      detail: "Binary verified and responsive",
    };
  }

  // 4. Attempt minimal MCP initialize handshake over stdio
  const handshakeResult = await attemptMcpHandshake(command, args, env, timeoutMs);
  return {
    name,
    status: handshakeResult.status,
    detail: handshakeResult.detail,
  };
}

async function attemptMcpHandshake(
  command: string,
  args: string[],
  customEnv?: Record<string, string>,
  timeoutMs = 5000
): Promise<{ status: DoctorStatus; detail: string }> {
  return new Promise((resolve) => {
    let resolved = false;

    const proc = cpOps.spawn ? cpOps.spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...customEnv },
    }) : spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...customEnv },
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve({
          status: "TIMEOUT",
          detail: `MCP initialize handshake timed out after ${timeoutMs}ms. Action: Verify server initialization parameters.`,
        });
      }
    }, timeoutMs);

    proc.on("error", (err: any) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          status: "HANDSHAKE_FAILED",
          detail: `Failed to spawn MCP server: ${err.message}. Action: Ensure server package and dependencies are installed.`,
        });
      }
    });

    const initMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "bharatcode-mcp-doctor",
          version: "1.0.0",
        },
      },
    }) + "\n";

    let stdoutBuffer = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf-8");
      if (stdoutBuffer.includes('"jsonrpc"') || stdoutBuffer.includes('"result"')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try {
            proc.kill();
          } catch {}
          resolve({
            status: "OK",
            detail: "MCP stdio initialize handshake succeeded",
          });
        }
      }
    });

    proc.on("close", (code: any) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        if (code === 0 || stdoutBuffer.includes('"result"')) {
          resolve({
            status: "OK",
            detail: "Server exited cleanly during handshake",
          });
        } else {
          resolve({
            status: "HANDSHAKE_FAILED",
            detail: `Server exited with code ${code} during MCP handshake. Action: Check server logs for startup errors.`,
          });
        }
      }
    });

    try {
      proc.stdin?.write(initMsg);
      proc.stdin?.end();
    } catch {
      // stdin error
    }
  });
}

export async function runDoctor(
  config: Record<string, any>,
  opts: RunDoctorOptions = {}
): Promise<DoctorResult[]> {
  const timeoutMs = opts.timeoutMs || 10000;
  const servers: DoctorTargetServer[] = [];

  if (config.mcp && typeof config.mcp === "object") {
    for (const [name, val] of Object.entries(config.mcp as Record<string, any>)) {
      if (val && Array.isArray(val.command) && val.command.length > 0) {
        servers.push({
          name,
          command: val.command[0],
          args: val.command.slice(1),
          env: val.environment || {},
        });
      }
    }
  } else if (config.mcpServers && typeof config.mcpServers === "object") {
    for (const [name, val] of Object.entries(config.mcpServers as Record<string, any>)) {
      if (val && val.command) {
        servers.push({
          name,
          command: val.command,
          args: Array.isArray(val.args) ? val.args : [],
          env: val.env || {},
        });
      }
    }
  }

  const results: DoctorResult[] = [];
  for (const server of servers) {
    const res = await checkServerBinary(server, timeoutMs);
    results.push(res);
  }

  return results;
}
