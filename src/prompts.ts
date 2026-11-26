import prompts from "prompts";

export interface EnvAnswer {
  mode: "shell" | "dotenv" | "skip";
  value?: string;
}

export async function askPreset(available: string[]): Promise<string> {
  const choices = available.map((preset) => ({
    title: preset,
    value: preset,
  }));

  const response = await prompts({
    type: "select",
    name: "preset",
    message: "Select an MCP preset to install:",
    choices,
    initial: choices.findIndex((c) => c.value === "core") >= 0 ? choices.findIndex((c) => c.value === "core") : 0,
  });

  return response.preset || "core";
}

export async function askServers(available: string[]): Promise<string[]> {
  const choices = available.map((srv) => ({
    title: srv,
    value: srv,
    selected: false,
  }));

  const response = await prompts({
    type: "multiselect",
    name: "servers",
    message: "Select servers to configure:",
    choices,
    min: 1,
  });

  return response.servers || [];
}

export async function askEnvKey(key: string, serverName: string): Promise<EnvAnswer> {
  const response = await prompts([
    {
      type: "select",
      name: "mode",
      message: `Environment variable '${key}' is required for server '${serverName}'. How would you like to handle it?`,
      choices: [
        { title: "Store in .env file", value: "dotenv" },
        { title: "Print shell export statement (do not persist)", value: "shell" },
        { title: "Skip (configure manually later)", value: "skip" },
      ],
      initial: 0,
    },
    {
      type: (prev) => (prev === "dotenv" || prev === "shell" ? "password" : null),
      name: "value",
      message: `Enter value for ${key}:`,
      validate: (val: string) => (val && val.trim().length > 0 ? true : "Value cannot be empty"),
    },
  ]);

  return {
    mode: response.mode || "skip",
    value: response.value,
  };
}
