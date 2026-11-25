#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import pc from "picocolors";
import { existsSync as existsSync2, readFileSync as readFileSync3, appendFileSync } from "fs";
import { resolve as resolve3 } from "path";

// src/registry.ts
import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
var CURRENT_SCHEMA_VERSION = "1";
var ServerSpecSchema = z.object({
  description: z.string(),
  runtime: z.enum(["npx", "uvx", "docker", "binary"]),
  command: z.string(),
  args: z.array(z.string()),
  requiredEnv: z.array(z.string()),
  optionalEnv: z.array(z.string()),
  comingSoon: z.boolean().optional()
});
var RegistrySchema = z.object({
  schemaVersion: z.string(),
  minCliVersion: z.string(),
  presets: z.record(z.string(), z.array(z.string())),
  servers: z.record(z.string(), ServerSpecSchema)
});
var cachedRegistry = null;
function getRegistryPath() {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  return resolve(currentDir, "../registry/servers.json");
}
function loadRegistry(customPath) {
  if (cachedRegistry && !customPath) {
    return cachedRegistry;
  }
  const filePath = customPath || getRegistryPath();
  let rawContent;
  try {
    rawContent = readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read MCP server registry at ${filePath}: ${message}`);
  }
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in MCP server registry at ${filePath}: ${message}`);
  }
  const result = RegistrySchema.safeParse(parsedJson);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Invalid registry schema format: ${errors}`);
  }
  const registry = result.data;
  if (registry.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported registry schemaVersion '${registry.schemaVersion}'. Expected '${CURRENT_SCHEMA_VERSION}'. Please update bharatcode-mcp.`
    );
  }
  if (!customPath) {
    cachedRegistry = registry;
  }
  return registry;
}
function resolvePreset(name, registry) {
  const reg = registry || loadRegistry();
  const preset = reg.presets[name];
  if (!preset) {
    const available = Object.keys(reg.presets).join(", ");
    throw new Error(`Preset '${name}' not found. Available presets: ${available}`);
  }
  return preset;
}
function getServer(name, registry) {
  const reg = registry || loadRegistry();
  const server = reg.servers[name];
  if (!server) {
    const available = Object.keys(reg.servers).join(", ");
    throw new Error(`Server '${name}' not found in registry. Available servers: ${available}`);
  }
  return server;
}

// src/detect.ts
import { resolve as resolve2, join } from "path";
import { homedir } from "os";

// src/cp-utils.ts
import child_process from "child_process";
var cpOps = {
  execSync: (cmd, opts) => child_process.execSync(cmd, opts),
  exec: (cmd, opts, callback) => child_process.exec(cmd, opts, callback),
  spawn: (cmd, args, opts) => child_process.spawn(cmd, args, opts)
};

// src/fs-utils.ts
import fs from "fs";
var fsOps = {
  renameSync: (oldPath, newPath) => fs.renameSync(oldPath, newPath),
  copyFileSync: (src, dest) => fs.copyFileSync(src, dest),
  unlinkSync: (path) => fs.unlinkSync(path),
  existsSync: (path) => fs.existsSync(path),
  readFileSync: (path, encoding) => fs.readFileSync(path, encoding).toString()
};

// src/detect.ts
var cachedRuntimes = null;
async function detectRuntimes() {
  if (cachedRuntimes) {
    return cachedRuntimes;
  }
  const checkCmd = (cmd) => {
    try {
      const isWin = process.platform === "win32";
      const lookup = isWin ? `where ${cmd}` : `which ${cmd}`;
      cpOps.execSync(lookup, { stdio: "ignore" });
      const versionOut = cpOps.execSync(`${cmd} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8"
      }).toString().trim();
      return { present: true, version: versionOut };
    } catch {
      return { present: false };
    }
  };
  const status = {
    node: checkCmd("node"),
    npx: checkCmd("npx"),
    uvx: checkCmd("uvx"),
    docker: checkCmd("docker")
  };
  cachedRuntimes = status;
  return status;
}
function resolveConfigPaths(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  if (opts.path) {
    return [resolve2(cwd, opts.path)];
  }
  const isWin = (opts.platform || process.platform) === "win32";
  let globalPath;
  if (isWin) {
    const appData = process.env.APPDATA || resolve2(homedir(), "AppData", "Roaming");
    const sep = "\\";
    globalPath = `${appData}${sep}bharatcode${sep}bharatcode.json`;
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    globalPath = join(xdgConfig, "bharatcode", "bharatcode.json");
  }
  const localPath = resolve2(cwd, "bharatcode.json");
  if (opts.global) {
    return [globalPath];
  }
  if (opts.local) {
    return [localPath];
  }
  const orderedCandidates = [];
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
async function detectSchema(binaryPath, userFlag) {
  if (userFlag && userFlag !== "unknown") {
    return {
      format: userFlag,
      source: "user-flag"
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
      }
      try {
        const verOutput = cpOps.execSync(`"${resolvedBin}" --version`, {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        }).toString().toLowerCase();
        if (verOutput.includes("claude")) {
          return { format: "claude", source: "binary-probe", path: resolvedBin };
        }
        if (verOutput.includes("opencode") || verOutput.includes("bharatcode")) {
          return { format: "opencode", source: "binary-probe", path: resolvedBin };
        }
      } catch {
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
        }
      }
    } catch {
    }
  }
  return {
    format: "opencode",
    source: "fallback"
  };
}

// src/writer.ts
import {
  existsSync,
  readFileSync as readFileSync2,
  writeFileSync,
  readdirSync,
  openSync,
  fsyncSync,
  closeSync,
  mkdirSync
} from "fs";
import { dirname as dirname2, basename } from "path";
import { z as z2 } from "zod";
var MANAGED_BY_KEY = "__managedBy";
var MANAGED_BY_VALUE = "bharatcode-mcp";
var OpencodeConfigSchema = z2.object({
  mcp: z2.record(
    z2.string(),
    z2.object({
      type: z2.literal("local"),
      command: z2.array(z2.string()),
      enabled: z2.boolean(),
      environment: z2.record(z2.string(), z2.string()).optional(),
      [MANAGED_BY_KEY]: z2.string().optional()
    }).passthrough()
  ).optional()
}).passthrough();
var ClaudeConfigSchema = z2.object({
  mcpServers: z2.record(
    z2.string(),
    z2.object({
      command: z2.string(),
      args: z2.array(z2.string()),
      env: z2.record(z2.string(), z2.string()).optional(),
      [MANAGED_BY_KEY]: z2.string().optional()
    }).passthrough()
  ).optional()
}).passthrough();
function inferIndent(content) {
  const match = content.match(/^[ \t]+(?="|\w)/m);
  if (!match) return 2;
  const whitespace = match[0];
  if (whitespace.includes("	")) {
    return "	";
  }
  return whitespace.length || 2;
}
function computeUnifiedDiff(oldStr, newStr, fileName) {
  const oldLines = oldStr === "" ? [] : oldStr.split("\n");
  const newLines = newStr === "" ? [] : newStr.split("\n");
  const diffLines = [
    `--- ${fileName}`,
    `+++ ${fileName}`
  ];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diffLines.push(` ${oldLines[i]}`);
      i++;
      j++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
      diffLines.push(`+${newLines[j]}`);
      j++;
    } else if (i < oldLines.length) {
      diffLines.push(`-${oldLines[i]}`);
      i++;
    }
  }
  return diffLines.join("\n");
}
var backupCounter = 0;
function manageBackups(configPath) {
  const dir = dirname2(configPath);
  const base = basename(configPath);
  backupCounter++;
  const isoDate = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.bak-${isoDate}-${backupCounter}`;
  fsOps.copyFileSync(configPath, backupPath);
  try {
    const files = readdirSync(dir);
    const prefix = `${base}.bak-`;
    const backups = files.filter((f) => f.startsWith(prefix)).sort();
    if (backups.length > 5) {
      const toDelete = backups.slice(0, backups.length - 5);
      for (const oldBak of toDelete) {
        try {
          fsOps.unlinkSync(`${dir}/${oldBak}`);
        } catch {
        }
      }
    }
  } catch {
  }
  return backupPath;
}
function mergeMcpConfig(configPath, servers, opts) {
  let existingContent = "";
  let existingObj = {};
  const fileExists = existsSync(configPath);
  if (fileExists) {
    existingContent = readFileSync2(configPath, "utf-8");
    try {
      existingObj = JSON.parse(existingContent);
      if (typeof existingObj !== "object" || existingObj === null || Array.isArray(existingObj)) {
        throw new Error("Config root must be a JSON object");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse existing config at ${configPath}: ${message}`);
    }
  }
  const indent = opts.indent !== void 0 ? opts.indent : fileExists ? inferIndent(existingContent) : 2;
  const mergedObj = JSON.parse(JSON.stringify(existingObj));
  const schemaFormat = opts.schema === "claude" ? "claude" : "opencode";
  if (schemaFormat === "claude") {
    if (!mergedObj.mcpServers || typeof mergedObj.mcpServers !== "object") {
      mergedObj.mcpServers = {};
    }
    const mcpServers = mergedObj.mcpServers;
    for (const [name, spec] of Object.entries(servers)) {
      const serverBlock = {
        command: spec.command,
        args: spec.args,
        [MANAGED_BY_KEY]: MANAGED_BY_VALUE
      };
      if (spec.env && Object.keys(spec.env).length > 0) {
        serverBlock.env = spec.env;
      }
      mcpServers[name] = serverBlock;
    }
  } else {
    if (!mergedObj.mcp || typeof mergedObj.mcp !== "object") {
      mergedObj.mcp = {};
    }
    const mcp = mergedObj.mcp;
    for (const [name, spec] of Object.entries(servers)) {
      const fullCommand = [spec.command, ...spec.args];
      const serverBlock = {
        type: "local",
        command: fullCommand,
        enabled: true,
        [MANAGED_BY_KEY]: MANAGED_BY_VALUE
      };
      if (spec.env && Object.keys(spec.env).length > 0) {
        serverBlock.environment = spec.env;
      }
      mcp[name] = serverBlock;
    }
  }
  const newContent = JSON.stringify(mergedObj, null, indent) + "\n";
  if (fileExists && existingContent.trim() === newContent.trim()) {
    return { changed: false };
  }
  if (opts.dryRun) {
    const diff2 = computeUnifiedDiff(existingContent, newContent, configPath);
    return {
      changed: true,
      diff: diff2
    };
  }
  let backupPath;
  const parentDir = dirname2(configPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  if (fileExists) {
    backupPath = manageBackups(configPath);
  }
  const tmpPath = `${configPath}.tmp`;
  try {
    writeFileSync(tmpPath, newContent, "utf-8");
    const fd = openSync(tmpPath, "r+");
    fsyncSync(fd);
    closeSync(fd);
    fsOps.renameSync(tmpPath, configPath);
  } catch (writeErr) {
    if (existsSync(tmpPath)) {
      try {
        fsOps.unlinkSync(tmpPath);
      } catch {
      }
    }
    if (backupPath && existsSync(backupPath)) {
      try {
        fsOps.copyFileSync(backupPath, configPath);
      } catch {
      }
    }
    const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
    throw new Error(`Atomic write failed for ${configPath}: ${message}`);
  }
  try {
    const writtenRaw = readFileSync2(configPath, "utf-8");
    const parsed = JSON.parse(writtenRaw);
    if (schemaFormat === "claude") {
      ClaudeConfigSchema.parse(parsed);
    } else {
      OpencodeConfigSchema.parse(parsed);
    }
  } catch (valErr) {
    if (backupPath && existsSync(backupPath)) {
      try {
        fsOps.copyFileSync(backupPath, configPath);
      } catch {
      }
    }
    const message = valErr instanceof Error ? valErr.message : String(valErr);
    throw new Error(`Post-write validation failed for ${configPath}: ${message}`);
  }
  const diff = computeUnifiedDiff(existingContent, newContent, configPath);
  return {
    changed: true,
    backupPath,
    diff
  };
}
function removeMcpServer(configPath, serverName, opts = {}) {
  if (!existsSync(configPath)) {
    throw new Error(`Config file does not exist at ${configPath}`);
  }
  const existingContent = readFileSync2(configPath, "utf-8");
  let existingObj;
  try {
    existingObj = JSON.parse(existingContent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config at ${configPath}: ${msg}`);
  }
  let found = false;
  let isManaged = false;
  if (existingObj.mcp && typeof existingObj.mcp === "object") {
    const mcp = existingObj.mcp;
    if (mcp[serverName]) {
      found = true;
      if (mcp[serverName][MANAGED_BY_KEY] === MANAGED_BY_VALUE) {
        isManaged = true;
        delete mcp[serverName];
      }
    }
  }
  if (existingObj.mcpServers && typeof existingObj.mcpServers === "object") {
    const mcpServers = existingObj.mcpServers;
    if (mcpServers[serverName]) {
      found = true;
      if (mcpServers[serverName][MANAGED_BY_KEY] === MANAGED_BY_VALUE) {
        isManaged = true;
        delete mcpServers[serverName];
      }
    }
  }
  if (!found) {
    throw new Error(`Server '${serverName}' was not found in ${configPath}`);
  }
  if (!isManaged) {
    throw new Error(
      `Server '${serverName}' was not managed by bharatcode-mcp (missing '${MANAGED_BY_KEY}' marker). Skipping remove to avoid overwriting custom configuration.`
    );
  }
  const indent = inferIndent(existingContent);
  const newContent = JSON.stringify(existingObj, null, indent) + "\n";
  if (opts.dryRun) {
    const diff = computeUnifiedDiff(existingContent, newContent, configPath);
    return { changed: true, diff };
  }
  const backupPath = manageBackups(configPath);
  const tmpPath = `${configPath}.tmp`;
  try {
    writeFileSync(tmpPath, newContent, "utf-8");
    const fd = openSync(tmpPath, "r+");
    fsyncSync(fd);
    closeSync(fd);
    fsOps.renameSync(tmpPath, configPath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        fsOps.unlinkSync(tmpPath);
      } catch {
      }
    }
    if (backupPath && existsSync(backupPath)) {
      try {
        fsOps.copyFileSync(backupPath, configPath);
      } catch {
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to atomically write updated config: ${msg}`);
  }
  return {
    changed: true,
    backupPath,
    diff: computeUnifiedDiff(existingContent, newContent, configPath)
  };
}

// src/doctor.ts
import { spawn } from "child_process";
function getResolutionTip(status, command, detail) {
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
async function checkServerBinary(server, timeoutMs = 1e4) {
  const { name, command, args, requiredEnv, env } = server;
  if (requiredEnv && requiredEnv.length > 0) {
    const missing = [];
    for (const key of requiredEnv) {
      const val = env && env[key] || process.env[key];
      if (!val) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      const detail = `Missing required environment variable(s): ${missing.join(", ")}`;
      return {
        name,
        status: "MISSING_ENV",
        detail: `${detail}. Action: Define ${missing.join(", ")} in your environment or .env file.`
      };
    }
  }
  const isWin = process.platform === "win32";
  const lookupCmd = isWin ? `where ${command}` : `which ${command}`;
  try {
    cpOps.execSync(lookupCmd, { stdio: "ignore" });
  } catch {
    const tip = getResolutionTip("MISSING_BINARY", command);
    return {
      name,
      status: "MISSING_BINARY",
      detail: `Binary '${command}' is not found in PATH. Action: ${tip}`
    };
  }
  let versionWorked = false;
  try {
    const res = await new Promise((resolve4, reject) => {
      cpOps.exec(`"${command}" --version`, { timeout: timeoutMs }, (err, stdout) => {
        if (err) return reject(err);
        resolve4(String(stdout || ""));
      });
    });
    if (res.trim().length > 0) {
      versionWorked = true;
    }
  } catch (err) {
    if (err?.name === "AbortError" || err?.killed || err?.signal === "SIGTERM") {
      return {
        name,
        status: "TIMEOUT",
        detail: `Timed out after ${timeoutMs}ms while executing '${command} --version'. Action: Check server responsiveness.`
      };
    }
  }
  if (versionWorked) {
    return {
      name,
      status: "OK",
      detail: "Binary verified and responsive"
    };
  }
  const handshakeResult = await attemptMcpHandshake(command, args, env, timeoutMs);
  return {
    name,
    status: handshakeResult.status,
    detail: handshakeResult.detail
  };
}
async function attemptMcpHandshake(command, args, customEnv, timeoutMs = 5e3) {
  return new Promise((resolve4) => {
    let resolved = false;
    const proc = cpOps.spawn ? cpOps.spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...customEnv }
    }) : spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...customEnv }
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          proc.kill("SIGKILL");
        } catch {
        }
        resolve4({
          status: "TIMEOUT",
          detail: `MCP initialize handshake timed out after ${timeoutMs}ms. Action: Verify server initialization parameters.`
        });
      }
    }, timeoutMs);
    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve4({
          status: "HANDSHAKE_FAILED",
          detail: `Failed to spawn MCP server: ${err.message}. Action: Ensure server package and dependencies are installed.`
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
          version: "1.0.0"
        }
      }
    }) + "\n";
    let stdoutBuffer = "";
    proc.stdout?.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf-8");
      if (stdoutBuffer.includes('"jsonrpc"') || stdoutBuffer.includes('"result"')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try {
            proc.kill();
          } catch {
          }
          resolve4({
            status: "OK",
            detail: "MCP stdio initialize handshake succeeded"
          });
        }
      }
    });
    proc.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        if (code === 0 || stdoutBuffer.includes('"result"')) {
          resolve4({
            status: "OK",
            detail: "Server exited cleanly during handshake"
          });
        } else {
          resolve4({
            status: "HANDSHAKE_FAILED",
            detail: `Server exited with code ${code} during MCP handshake. Action: Check server logs for startup errors.`
          });
        }
      }
    });
    try {
      proc.stdin?.write(initMsg);
      proc.stdin?.end();
    } catch {
    }
  });
}
async function runDoctor(config, opts = {}) {
  const timeoutMs = opts.timeoutMs || 1e4;
  const servers = [];
  if (config.mcp && typeof config.mcp === "object") {
    for (const [name, val] of Object.entries(config.mcp)) {
      if (val && Array.isArray(val.command) && val.command.length > 0) {
        servers.push({
          name,
          command: val.command[0],
          args: val.command.slice(1),
          env: val.environment || {}
        });
      }
    }
  } else if (config.mcpServers && typeof config.mcpServers === "object") {
    for (const [name, val] of Object.entries(config.mcpServers)) {
      if (val && val.command) {
        servers.push({
          name,
          command: val.command,
          args: Array.isArray(val.args) ? val.args : [],
          env: val.env || {}
        });
      }
    }
  }
  const results = [];
  for (const server of servers) {
    const res = await checkServerBinary(server, timeoutMs);
    results.push(res);
  }
  return results;
}

// src/prompts.ts
import prompts from "prompts";
async function askPreset(available) {
  const choices = available.map((preset) => ({
    title: preset,
    value: preset
  }));
  const response = await prompts({
    type: "select",
    name: "preset",
    message: "Select an MCP preset to install:",
    choices,
    initial: choices.findIndex((c) => c.value === "core") >= 0 ? choices.findIndex((c) => c.value === "core") : 0
  });
  return response.preset || "core";
}
async function askEnvKey(key, serverName) {
  const response = await prompts([
    {
      type: "select",
      name: "mode",
      message: `Environment variable '${key}' is required for server '${serverName}'. How would you like to handle it?`,
      choices: [
        { title: "Store in .env file", value: "dotenv" },
        { title: "Print shell export statement (do not persist)", value: "shell" },
        { title: "Skip (configure manually later)", value: "skip" }
      ],
      initial: 0
    },
    {
      type: (prev) => prev === "dotenv" || prev === "shell" ? "password" : null,
      name: "value",
      message: `Enter value for ${key}:`,
      validate: (val) => val && val.trim().length > 0 ? true : "Value cannot be empty"
    }
  ]);
  return {
    mode: response.mode || "skip",
    value: response.value
  };
}

// src/cli.ts
function createCli() {
  const program = new Command();
  program.name("bharatcode-mcp").description("Install and manage MCP servers for BharatCode CLI and Desktop").version("1.0.0");
  program.command("init").description("Initialize and install MCP servers using a curated preset").option("--preset <name>", "Preset name to install (e.g., core, fullstack, browser, data)").option("--servers <list>", "Comma-separated list of server names to install").option("--global", "Write to global config path").option("--local", "Write to local bharatcode.json in cwd").option("--path <file>", "Explicit path to configuration file").option("--schema <format>", "Schema format (auto, opencode, claude)", "auto").option("--yes", "Non-interactive mode with default answers", false).option("--dry-run", "Preview changes without modifying disk", false).option("--json", "Output results in JSON format", false).action(async (options) => {
    try {
      const registry = loadRegistry();
      let targetServers = [];
      if (options.servers) {
        targetServers = options.servers.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (options.preset) {
        targetServers = resolvePreset(options.preset, registry);
      } else if (options.yes) {
        targetServers = resolvePreset("core", registry);
      } else {
        const presetChoice = await askPreset(Object.keys(registry.presets));
        targetServers = resolvePreset(presetChoice, registry);
      }
      for (const s of targetServers) {
        getServer(s, registry);
      }
      const runtimes = await detectRuntimes();
      if (!runtimes.npx.present && !options.dryRun) {
        const msg = "Node.js 20+ and npx are required but npx was not found in PATH. Please install Node.js: https://nodejs.org";
        if (options.json) {
          console.error(JSON.stringify({ error: msg }));
        } else {
          console.error(pc.red(`Error: ${msg}`));
        }
        process.exit(1);
      }
      const candidatePaths = resolveConfigPaths({
        path: options.path,
        global: options.global,
        local: options.local
      });
      const configPath = candidatePaths[0];
      const schemaOpt = options.schema === "auto" ? void 0 : options.schema;
      const detected = await detectSchema(void 0, schemaOpt);
      const activeSchema = detected.format;
      const serverSpecsToWrite = {};
      for (const s of targetServers) {
        const spec = getServer(s, registry);
        const serverEnv = {};
        if (spec.requiredEnv && spec.requiredEnv.length > 0) {
          for (const envKey of spec.requiredEnv) {
            const currentVal = process.env[envKey];
            if (currentVal) {
              serverEnv[envKey] = currentVal;
              continue;
            }
            if (options.yes) {
              const errMsg = `Missing required environment variable '${envKey}' for server '${s}'. Please set ${envKey} in your environment or run interactively.`;
              if (options.json) {
                console.error(JSON.stringify({ error: errMsg, missingEnv: envKey, server: s }));
              } else {
                console.error(pc.red(`Error: ${errMsg}`));
              }
              process.exit(1);
            }
            const ans = await askEnvKey(envKey, s);
            if (ans.mode === "dotenv" && ans.value) {
              serverEnv[envKey] = ans.value;
              const dotenvPath = resolve3(process.cwd(), ".env");
              appendFileSync(dotenvPath, `
${envKey}="${ans.value}"
`, "utf-8");
              if (!options.json) {
                console.log(pc.green(`Saved ${envKey} to ${dotenvPath}`));
              }
            } else if (ans.mode === "shell" && ans.value) {
              if (!options.json) {
                console.log(pc.yellow(`Run in your shell: export ${envKey}="${ans.value}"`));
              }
            }
          }
        }
        serverSpecsToWrite[s] = {
          ...spec,
          env: Object.keys(serverEnv).length > 0 ? serverEnv : void 0
        };
      }
      const writeResult = mergeMcpConfig(configPath, serverSpecsToWrite, {
        schema: activeSchema,
        dryRun: options.dryRun
      });
      let doctorResults = [];
      if (!options.dryRun && existsSync2(configPath)) {
        const fileRaw = readFileSync3(configPath, "utf-8");
        const parsedConfig = JSON.parse(fileRaw);
        doctorResults = await runDoctor(parsedConfig);
      }
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: "success",
              configPath,
              serversInstalled: targetServers,
              changed: writeResult.changed,
              backupPath: writeResult.backupPath,
              diff: writeResult.diff,
              doctor: doctorResults
            },
            null,
            2
          )
        );
      } else {
        if (options.dryRun) {
          console.log(pc.cyan(`[Dry-run] Changes to ${configPath}:`));
          console.log(writeResult.diff || "(No changes)");
        } else {
          console.log(
            pc.green(
              `Successfully configured ${targetServers.length} MCP server(s) in ${configPath}`
            )
          );
          if (writeResult.backupPath) {
            console.log(pc.dim(`Backup saved to ${writeResult.backupPath}`));
          }
          if (doctorResults.length > 0) {
            console.log("\nServer Doctor Status:");
            for (const doc of doctorResults) {
              const color = doc.status === "OK" ? pc.green : pc.red;
              console.log(`  ${pc.bold(doc.name)}: ${color(doc.status)} - ${doc.detail || ""}`);
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.json) {
        console.error(JSON.stringify({ error: msg }));
      } else {
        console.error(pc.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });
  program.command("add <server>").description("Add a specific MCP server from the registry").option("--global", "Write to global config path").option("--local", "Write to local bharatcode.json in cwd").option("--path <file>", "Explicit path to configuration file").option("--schema <format>", "Schema format (auto, opencode, claude)", "auto").option("--yes", "Non-interactive mode", false).option("--dry-run", "Preview changes without modifying disk", false).option("--json", "Output results in JSON format", false).action(async (serverName, options) => {
    try {
      const registry = loadRegistry();
      const spec = getServer(serverName, registry);
      const candidatePaths = resolveConfigPaths({
        path: options.path,
        global: options.global,
        local: options.local
      });
      const configPath = candidatePaths[0];
      const schemaOpt = options.schema === "auto" ? void 0 : options.schema;
      const detected = await detectSchema(void 0, schemaOpt);
      const activeSchema = detected.format;
      const serverEnv = {};
      if (spec.requiredEnv && spec.requiredEnv.length > 0) {
        for (const envKey of spec.requiredEnv) {
          const currentVal = process.env[envKey];
          if (currentVal) {
            serverEnv[envKey] = currentVal;
            continue;
          }
          if (options.yes) {
            const errMsg = `Missing required environment variable '${envKey}' for server '${serverName}'.`;
            if (options.json) {
              console.error(JSON.stringify({ error: errMsg, missingEnv: envKey }));
            } else {
              console.error(pc.red(`Error: ${errMsg}`));
            }
            process.exit(1);
          }
          const ans = await askEnvKey(envKey, serverName);
          if (ans.mode === "dotenv" && ans.value) {
            serverEnv[envKey] = ans.value;
            const dotenvPath = resolve3(process.cwd(), ".env");
            appendFileSync(dotenvPath, `
${envKey}="${ans.value}"
`, "utf-8");
            if (!options.json) {
              console.log(pc.green(`Saved ${envKey} to ${dotenvPath}`));
            }
          } else if (ans.mode === "shell" && ans.value) {
            if (!options.json) {
              console.log(pc.yellow(`Run in your shell: export ${envKey}="${ans.value}"`));
            }
          }
        }
      }
      const toWrite = {
        [serverName]: {
          ...spec,
          env: Object.keys(serverEnv).length > 0 ? serverEnv : void 0
        }
      };
      const result = mergeMcpConfig(configPath, toWrite, {
        schema: activeSchema,
        dryRun: options.dryRun
      });
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: "success",
              server: serverName,
              configPath,
              changed: result.changed,
              backupPath: result.backupPath,
              diff: result.diff
            },
            null,
            2
          )
        );
      } else {
        if (options.dryRun) {
          console.log(pc.cyan(`[Dry-run] Add '${serverName}' to ${configPath}:`));
          console.log(result.diff || "(No changes)");
        } else {
          console.log(pc.green(`Added '${serverName}' to ${configPath}`));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.json) {
        console.error(JSON.stringify({ error: msg }));
      } else {
        console.error(pc.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });
  program.command("remove <server>").description("Remove an MCP server managed by bharatcode-mcp").option("--global", "Write to global config path").option("--local", "Write to local bharatcode.json in cwd").option("--path <file>", "Explicit path to configuration file").option("--dry-run", "Preview changes without modifying disk", false).option("--json", "Output results in JSON format", false).action(async (serverName, options) => {
    try {
      const candidatePaths = resolveConfigPaths({
        path: options.path,
        global: options.global,
        local: options.local
      });
      const configPath = candidatePaths[0];
      const result = removeMcpServer(configPath, serverName, {
        dryRun: options.dryRun
      });
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: "success",
              server: serverName,
              configPath,
              changed: result.changed,
              backupPath: result.backupPath,
              diff: result.diff
            },
            null,
            2
          )
        );
      } else {
        if (options.dryRun) {
          console.log(pc.cyan(`[Dry-run] Remove '${serverName}' from ${configPath}:`));
          console.log(result.diff || "(No changes)");
        } else {
          console.log(pc.green(`Removed '${serverName}' from ${configPath}`));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.json) {
        console.error(JSON.stringify({ error: msg }));
      } else {
        console.error(pc.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });
  program.command("list").description("List available and installed MCP servers").option("--installed", "Show only installed servers in active configuration", false).option("--preset <name>", "Filter by preset").option("--path <file>", "Configuration file to inspect for installed status").option("--json", "Output results in JSON format", false).action(async (options) => {
    try {
      const registry = loadRegistry();
      const candidatePaths = resolveConfigPaths({ path: options.path });
      const configPath = candidatePaths[0];
      let installedKeys = /* @__PURE__ */ new Set();
      if (existsSync2(configPath)) {
        try {
          const raw = JSON.parse(readFileSync3(configPath, "utf-8"));
          if (raw.mcp && typeof raw.mcp === "object") {
            Object.keys(raw.mcp).forEach((k) => installedKeys.add(k));
          }
          if (raw.mcpServers && typeof raw.mcpServers === "object") {
            Object.keys(raw.mcpServers).forEach((k) => installedKeys.add(k));
          }
        } catch {
        }
      }
      let serverNames = Object.keys(registry.servers);
      if (options.preset) {
        serverNames = resolvePreset(options.preset, registry);
      }
      if (options.installed) {
        serverNames = serverNames.filter((name) => installedKeys.has(name));
      }
      const rows = serverNames.map((name) => {
        const spec = registry.servers[name];
        const isInstalled = installedKeys.has(name);
        const required = spec.requiredEnv && spec.requiredEnv.length > 0 ? spec.requiredEnv.join(", ") : "none";
        return {
          name,
          runtime: spec.runtime,
          required,
          installed: isInstalled,
          description: spec.description
        };
      });
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        if (rows.length === 0) {
          console.log(pc.yellow("No servers found matching criteria."));
          return;
        }
        console.log(
          `${pc.bold("NAME".padEnd(16))} ${pc.bold("RUNTIME".padEnd(10))} ${pc.bold("REQUIRED ENV".padEnd(16))} ${pc.bold("INSTALLED".padEnd(12))} ${pc.bold("DESCRIPTION")}`
        );
        console.log("-".repeat(80));
        for (const row of rows) {
          const installedStr = row.installed ? pc.green("yes") : pc.dim("no");
          console.log(
            `${pc.cyan(row.name.padEnd(16))} ${row.runtime.padEnd(10)} ${row.required.padEnd(16)} ${installedStr.padEnd(12)} ${row.description}`
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.json) {
        console.error(JSON.stringify({ error: msg }));
      } else {
        console.error(pc.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });
  program.command("doctor").description("Verify that all configured MCP servers start and respond properly").option("--path <file>", "Configuration file to verify").option("--fix", "Offer runtime installation fixes for broken servers", false).option("--json", "Output raw verification results in JSON format", false).action(async (options) => {
    try {
      const candidatePaths = resolveConfigPaths({ path: options.path });
      const configPath = candidatePaths[0];
      if (!existsSync2(configPath)) {
        const msg = `Config file not found at ${configPath}. Run 'bharatcode-mcp init' first.`;
        if (options.json) {
          console.log(JSON.stringify({ error: msg, results: [] }));
        } else {
          console.error(pc.red(`Error: ${msg}`));
        }
        process.exit(1);
      }
      const raw = JSON.parse(readFileSync3(configPath, "utf-8"));
      const results = await runDoctor(raw);
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(pc.bold(`
MCP Doctor Verification for ${configPath}
`));
        console.log(
          `${pc.bold("SERVER".padEnd(16))} ${pc.bold("STATUS".padEnd(18))} ${pc.bold("DETAIL")}`
        );
        console.log("-".repeat(80));
        let hasFailure = false;
        for (const res of results) {
          let statusColor = pc.green;
          if (res.status !== "OK") {
            statusColor = pc.red;
            hasFailure = true;
          }
          console.log(
            `${pc.cyan(res.name.padEnd(16))} ${statusColor(res.status.padEnd(18))} ${res.detail || ""}`
          );
        }
        if (hasFailure && options.fix) {
          console.log(pc.yellow("\n[Fix mode] You can install missing runtimes via:"));
          console.log(pc.dim("  For uvx (Python): curl -LsSf https://astral.sh/uv/install.sh | sh"));
          console.log(pc.dim("  For Node/npx:     https://nodejs.org or nvm install 20"));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.json) {
        console.error(JSON.stringify({ error: msg }));
      } else {
        console.error(pc.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });
  return program;
}
if (process.argv[1] && (process.argv[1].endsWith("cli.js") || process.argv[1].endsWith("cli.ts"))) {
  const cli = createCli();
  cli.parseAsync(process.argv);
}
export {
  createCli
};
