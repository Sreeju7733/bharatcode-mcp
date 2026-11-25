import { Command } from "commander";
import pc from "picocolors";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRegistry, resolvePreset, getServer } from "./registry.js";
import { resolveConfigPaths, detectSchema, detectRuntimes } from "./detect.js";
import { mergeMcpConfig, removeMcpServer } from "./writer.js";
import { runDoctor } from "./doctor.js";
import { askPreset, askEnvKey } from "./prompts.js";
import type { SchemaFormat, ServerSpec } from "./types.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("bharatcode-mcp")
    .description("Install and manage MCP servers for BharatCode CLI and Desktop")
    .version("1.0.0");

  program
    .command("init")
    .description("Initialize and install MCP servers using a curated preset")
    .option("--preset <name>", "Preset name to install (e.g., core, fullstack, browser, data)")
    .option("--servers <list>", "Comma-separated list of server names to install")
    .option("--global", "Write to global config path")
    .option("--local", "Write to local bharatcode.json in cwd")
    .option("--path <file>", "Explicit path to configuration file")
    .option("--schema <format>", "Schema format (auto, opencode, claude)", "auto")
    .option("--yes", "Non-interactive mode with default answers", false)
    .option("--dry-run", "Preview changes without modifying disk", false)
    .option("--json", "Output results in JSON format", false)
    .action(async (options) => {
      try {
        const registry = loadRegistry();
        let targetServers: string[] = [];

        if (options.servers) {
          targetServers = options.servers.split(",").map((s: string) => s.trim()).filter(Boolean);
        } else if (options.preset) {
          targetServers = resolvePreset(options.preset, registry);
        } else if (options.yes) {
          targetServers = resolvePreset("core", registry);
        } else {
          const presetChoice = await askPreset(Object.keys(registry.presets));
          targetServers = resolvePreset(presetChoice, registry);
        }

        // Verify servers in registry
        for (const s of targetServers) {
          getServer(s, registry);
        }

        // Check runtimes
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

        // Resolve config path
        const candidatePaths = resolveConfigPaths({
          path: options.path,
          global: options.global,
          local: options.local,
        });
        const configPath = candidatePaths[0];

        // Resolve schema
        const schemaOpt = (options.schema === "auto" ? undefined : options.schema) as SchemaFormat | undefined;
        const detected = await detectSchema(undefined, schemaOpt);
        const activeSchema: SchemaFormat = detected.format;

        // Collect env variables
        const serverSpecsToWrite: Record<string, ServerSpec & { env?: Record<string, string> }> = {};

        for (const s of targetServers) {
          const spec = getServer(s, registry);
          const serverEnv: Record<string, string> = {};

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

              // Interactive prompt
              const ans = await askEnvKey(envKey, s);
              if (ans.mode === "dotenv" && ans.value) {
                serverEnv[envKey] = ans.value;
                const dotenvPath = resolve(process.cwd(), ".env");
                appendFileSync(dotenvPath, `\n${envKey}="${ans.value}"\n`, "utf-8");
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
            env: Object.keys(serverEnv).length > 0 ? serverEnv : undefined,
          };
        }

        // Merge and write config
        const writeResult = mergeMcpConfig(configPath, serverSpecsToWrite, {
          schema: activeSchema,
          dryRun: options.dryRun,
        });

        // Run doctor if not dry run
        let doctorResults: any[] = [];
        if (!options.dryRun && existsSync(configPath)) {
          const fileRaw = readFileSync(configPath, "utf-8");
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
                doctor: doctorResults,
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.error(JSON.stringify({ error: msg }));
        } else {
          console.error(pc.red(`Error: ${msg}`));
        }
        process.exit(1);
      }
    });

  program
    .command("add <server>")
    .description("Add a specific MCP server from the registry")
    .option("--global", "Write to global config path")
    .option("--local", "Write to local bharatcode.json in cwd")
    .option("--path <file>", "Explicit path to configuration file")
    .option("--schema <format>", "Schema format (auto, opencode, claude)", "auto")
    .option("--yes", "Non-interactive mode", false)
    .option("--dry-run", "Preview changes without modifying disk", false)
    .option("--json", "Output results in JSON format", false)
    .action(async (serverName, options) => {
      try {
        const registry = loadRegistry();
        const spec = getServer(serverName, registry);

        const candidatePaths = resolveConfigPaths({
          path: options.path,
          global: options.global,
          local: options.local,
        });
        const configPath = candidatePaths[0];

        const schemaOpt = (options.schema === "auto" ? undefined : options.schema) as SchemaFormat | undefined;
        const detected = await detectSchema(undefined, schemaOpt);
        const activeSchema: SchemaFormat = detected.format;

        const serverEnv: Record<string, string> = {};
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
              const dotenvPath = resolve(process.cwd(), ".env");
              appendFileSync(dotenvPath, `\n${envKey}="${ans.value}"\n`, "utf-8");
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
            env: Object.keys(serverEnv).length > 0 ? serverEnv : undefined,
          },
        };

        const result = mergeMcpConfig(configPath, toWrite, {
          schema: activeSchema,
          dryRun: options.dryRun,
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
                diff: result.diff,
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.error(JSON.stringify({ error: msg }));
        } else {
          console.error(pc.red(`Error: ${msg}`));
        }
        process.exit(1);
      }
    });

  program
    .command("remove <server>")
    .description("Remove an MCP server managed by bharatcode-mcp")
    .option("--global", "Write to global config path")
    .option("--local", "Write to local bharatcode.json in cwd")
    .option("--path <file>", "Explicit path to configuration file")
    .option("--dry-run", "Preview changes without modifying disk", false)
    .option("--json", "Output results in JSON format", false)
    .action(async (serverName, options) => {
      try {
        const candidatePaths = resolveConfigPaths({
          path: options.path,
          global: options.global,
          local: options.local,
        });
        const configPath = candidatePaths[0];

        const result = removeMcpServer(configPath, serverName, {
          dryRun: options.dryRun,
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
                diff: result.diff,
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.error(JSON.stringify({ error: msg }));
        } else {
          console.error(pc.red(`Error: ${msg}`));
        }
        process.exit(1);
      }
    });

  program
    .command("list")
    .description("List available and installed MCP servers")
    .option("--installed", "Show only installed servers in active configuration", false)
    .option("--preset <name>", "Filter by preset")
    .option("--path <file>", "Configuration file to inspect for installed status")
    .option("--json", "Output results in JSON format", false)
    .action(async (options) => {
      try {
        const registry = loadRegistry();
        const candidatePaths = resolveConfigPaths({ path: options.path });
        const configPath = candidatePaths[0];

        let installedKeys: Set<string> = new Set();
        if (existsSync(configPath)) {
          try {
            const raw = JSON.parse(readFileSync(configPath, "utf-8"));
            if (raw.mcp && typeof raw.mcp === "object") {
              Object.keys(raw.mcp).forEach((k) => installedKeys.add(k));
            }
            if (raw.mcpServers && typeof raw.mcpServers === "object") {
              Object.keys(raw.mcpServers).forEach((k) => installedKeys.add(k));
            }
          } catch {}
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
            description: spec.description,
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.error(JSON.stringify({ error: msg }));
        } else {
          console.error(pc.red(`Error: ${msg}`));
        }
        process.exit(1);
      }
    });

  program
    .command("doctor")
    .description("Verify that all configured MCP servers start and respond properly")
    .option("--path <file>", "Configuration file to verify")
    .option("--fix", "Offer runtime installation fixes for broken servers", false)
    .option("--json", "Output raw verification results in JSON format", false)
    .action(async (options) => {
      try {
        const candidatePaths = resolveConfigPaths({ path: options.path });
        const configPath = candidatePaths[0];

        if (!existsSync(configPath)) {
          const msg = `Config file not found at ${configPath}. Run 'bharatcode-mcp init' first.`;
          if (options.json) {
            console.log(JSON.stringify({ error: msg, results: [] }));
          } else {
            console.error(pc.red(`Error: ${msg}`));
          }
          process.exit(1);
        }

        const raw = JSON.parse(readFileSync(configPath, "utf-8"));
        const results = await runDoctor(raw);

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          console.log(pc.bold(`\nMCP Doctor Verification for ${configPath}\n`));
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
      } catch (err: unknown) {
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
