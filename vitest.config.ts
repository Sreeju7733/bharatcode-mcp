import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 85,
        branches: 80,
      },
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/types.ts", "src/prompts.ts", "src/fs-utils.ts", "src/cp-utils.ts"],
    },
  },
});
