import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Registry, ServerSpec } from "./types.js";

const CURRENT_SCHEMA_VERSION = "1";

export const ServerSpecSchema = z.object({
  description: z.string(),
  runtime: z.enum(["npx", "uvx", "docker", "binary"]),
  command: z.string(),
  args: z.array(z.string()),
  requiredEnv: z.array(z.string()),
  optionalEnv: z.array(z.string()),
  comingSoon: z.boolean().optional(),
});

export const RegistrySchema = z.object({
  schemaVersion: z.string(),
  minCliVersion: z.string(),
  presets: z.record(z.string(), z.array(z.string())),
  servers: z.record(z.string(), ServerSpecSchema),
});

let cachedRegistry: Registry | null = null;

export function getRegistryPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  // Works both in dev (src/../registry/servers.json) and bundled (dist/../registry/servers.json)
  return resolve(currentDir, "../registry/servers.json");
}

export function loadRegistry(customPath?: string): Registry {
  if (cachedRegistry && !customPath) {
    return cachedRegistry;
  }

  const filePath = customPath || getRegistryPath();
  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read MCP server registry at ${filePath}: ${message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in MCP server registry at ${filePath}: ${message}`);
  }

  const result = RegistrySchema.safeParse(parsedJson);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Invalid registry schema format: ${errors}`);
  }

  const registry = result.data as Registry;

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

export function resolvePreset(name: string, registry?: Registry): string[] {
  const reg = registry || loadRegistry();
  const preset = reg.presets[name];
  if (!preset) {
    const available = Object.keys(reg.presets).join(", ");
    throw new Error(`Preset '${name}' not found. Available presets: ${available}`);
  }
  return preset;
}

export function getServer(name: string, registry?: Registry): ServerSpec {
  const reg = registry || loadRegistry();
  const server = reg.servers[name];
  if (!server) {
    const available = Object.keys(reg.servers).join(", ");
    throw new Error(`Server '${name}' not found in registry. Available servers: ${available}`);
  }
  return server;
}
