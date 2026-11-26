import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  openSync,
  fsyncSync,
  closeSync,
  mkdirSync,
} from "node:fs";
import { dirname, basename } from "node:path";
import { z } from "zod";
import type { SchemaFormat, ServerSpec } from "./types.js";
import { fsOps } from "./fs-utils.js";

export const MANAGED_BY_KEY = "__managedBy";
export const MANAGED_BY_VALUE = "bharatcode-mcp";

export interface WriteOptions {
  schema: SchemaFormat;
  dryRun?: boolean;
  indent?: number | "\t";
}

const OpencodeConfigSchema = z.object({
  mcp: z.record(
    z.string(),
    z.object({
      type: z.literal("local"),
      command: z.array(z.string()),
      enabled: z.boolean(),
      environment: z.record(z.string(), z.string()).optional(),
      [MANAGED_BY_KEY]: z.string().optional(),
    }).passthrough()
  ).optional(),
}).passthrough();

const ClaudeConfigSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({
      command: z.string(),
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()).optional(),
      [MANAGED_BY_KEY]: z.string().optional(),
    }).passthrough()
  ).optional(),
}).passthrough();

export function inferIndent(content: string): number | "\t" {
  const match = content.match(/^[ \t]+(?="|\w)/m);
  if (!match) return 2;
  const whitespace = match[0];
  if (whitespace.includes("\t")) {
    return "\t";
  }
  return whitespace.length || 2;
}

export function computeUnifiedDiff(oldStr: string, newStr: string, fileName: string): string {
  const oldLines = oldStr === "" ? [] : oldStr.split("\n");
  const newLines = newStr === "" ? [] : newStr.split("\n");

  const diffLines: string[] = [
    `--- ${fileName}`,
    `+++ ${fileName}`,
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

let backupCounter = 0;

function manageBackups(configPath: string): string {
  const dir = dirname(configPath);
  const base = basename(configPath);
  backupCounter++;
  const isoDate = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.bak-${isoDate}-${backupCounter}`;

  // Backup first: copyFileSync
  fsOps.copyFileSync(configPath, backupPath);

  // Keep 5 most recent, delete older
  try {
    const files = readdirSync(dir);
    const prefix = `${base}.bak-`;
    const backups = files
      .filter((f) => f.startsWith(prefix))
      .sort();

    if (backups.length > 5) {
      const toDelete = backups.slice(0, backups.length - 5);
      for (const oldBak of toDelete) {
        try {
          fsOps.unlinkSync(`${dir}/${oldBak}`);
        } catch {
          // ignore cleanup failures
        }
      }
    }
  } catch {
    // ignore readdir errors
  }

  return backupPath;
}

export function mergeMcpConfig(
  configPath: string,
  servers: Record<string, ServerSpec & { env?: Record<string, string> }>,
  opts: WriteOptions
): { changed: boolean; backupPath?: string; diff?: string } {
  let existingContent = "";
  let existingObj: Record<string, unknown> = {};
  const fileExists = existsSync(configPath);

  if (fileExists) {
    existingContent = readFileSync(configPath, "utf-8");
    try {
      existingObj = JSON.parse(existingContent);
      if (typeof existingObj !== "object" || existingObj === null || Array.isArray(existingObj)) {
        throw new Error("Config root must be a JSON object");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse existing config at ${configPath}: ${message}`);
    }
  }

  const indent = opts.indent !== undefined ? opts.indent : (fileExists ? inferIndent(existingContent) : 2);

  const mergedObj: Record<string, unknown> = JSON.parse(JSON.stringify(existingObj));
  const schemaFormat = opts.schema === "claude" ? "claude" : "opencode";

  if (schemaFormat === "claude") {
    if (!mergedObj.mcpServers || typeof mergedObj.mcpServers !== "object") {
      mergedObj.mcpServers = {};
    }
    const mcpServers = mergedObj.mcpServers as Record<string, unknown>;

    for (const [name, spec] of Object.entries(servers)) {
      const serverBlock: Record<string, unknown> = {
        command: spec.command,
        args: spec.args,
        [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
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
    const mcp = mergedObj.mcp as Record<string, unknown>;

    for (const [name, spec] of Object.entries(servers)) {
      const fullCommand = [spec.command, ...spec.args];
      const serverBlock: Record<string, unknown> = {
        type: "local",
        command: fullCommand,
        enabled: true,
        [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
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
    const diff = computeUnifiedDiff(existingContent, newContent, configPath);
    return {
      changed: true,
      diff,
    };
  }

  let backupPath: string | undefined;
  const parentDir = dirname(configPath);
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
  } catch (writeErr: unknown) {
    if (existsSync(tmpPath)) {
      try {
        fsOps.unlinkSync(tmpPath);
      } catch {}
    }
    if (backupPath && existsSync(backupPath)) {
      try {
        fsOps.copyFileSync(backupPath, configPath);
      } catch {}
    }
    const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
    throw new Error(`Atomic write failed for ${configPath}: ${message}`);
  }

  try {
    const writtenRaw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(writtenRaw);
    if (schemaFormat === "claude") {
      ClaudeConfigSchema.parse(parsed);
    } else {
      OpencodeConfigSchema.parse(parsed);
    }
  } catch (valErr: unknown) {
    if (backupPath && existsSync(backupPath)) {
      try {
        fsOps.copyFileSync(backupPath, configPath);
      } catch {}
    }
    const message = valErr instanceof Error ? valErr.message : String(valErr);
    throw new Error(`Post-write validation failed for ${configPath}: ${message}`);
  }

  const diff = computeUnifiedDiff(existingContent, newContent, configPath);
  return {
    changed: true,
    backupPath,
    diff,
  };
}

export function removeMcpServer(
  configPath: string,
  serverName: string,
  opts: { dryRun?: boolean; schema?: SchemaFormat } = {}
): { changed: boolean; backupPath?: string; diff?: string } {
  if (!existsSync(configPath)) {
    throw new Error(`Config file does not exist at ${configPath}`);
  }

  const existingContent = readFileSync(configPath, "utf-8");
  let existingObj: Record<string, unknown>;
  try {
    existingObj = JSON.parse(existingContent);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config at ${configPath}: ${msg}`);
  }

  let found = false;
  let isManaged = false;

  if (existingObj.mcp && typeof existingObj.mcp === "object") {
    const mcp = existingObj.mcp as Record<string, any>;
    if (mcp[serverName]) {
      found = true;
      if (mcp[serverName][MANAGED_BY_KEY] === MANAGED_BY_VALUE) {
        isManaged = true;
        delete mcp[serverName];
      }
    }
  }

  if (existingObj.mcpServers && typeof existingObj.mcpServers === "object") {
    const mcpServers = existingObj.mcpServers as Record<string, any>;
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
  } catch (err: unknown) {
    if (existsSync(tmpPath)) {
      try { fsOps.unlinkSync(tmpPath); } catch {}
    }
    if (backupPath && existsSync(backupPath)) {
      try { fsOps.copyFileSync(backupPath, configPath); } catch {}
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to atomically write updated config: ${msg}`);
  }

  return {
    changed: true,
    backupPath,
    diff: computeUnifiedDiff(existingContent, newContent, configPath),
  };
}
