import { describe, it, expect } from "vitest";
import { loadRegistry, resolvePreset, getServer } from "../src/registry.js";

describe("registry", () => {
  it("loads and validates registry correctly", () => {
    const reg = loadRegistry();
    expect(reg.schemaVersion).toBe("1");
    expect(reg.presets.core).toBeDefined();
    expect(reg.servers.git).toBeDefined();
    expect(reg.servers.filesystem).toBeDefined();
  });

  it("resolves preset or throws on unknown preset", () => {
    const reg = loadRegistry();
    const core = resolvePreset("core", reg);
    expect(core).toContain("git");
    expect(core).toContain("filesystem");

    expect(() => resolvePreset("unknown_preset", reg)).toThrow("not found");
  });

  it("gets server or throws on unknown server", () => {
    const reg = loadRegistry();
    const git = getServer("git", reg);
    expect(git.runtime).toBe("uvx");

    expect(() => getServer("unknown_server", reg)).toThrow("not found");
  });
});
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

describe("registry validation and errors", () => {
  it("throws on unsupported schemaVersion", () => {
    const tmpReg = resolve(tmpdir(), `test-reg-${Date.now()}.json`);
    writeFileSync(tmpReg, JSON.stringify({
      schemaVersion: "99",
      minCliVersion: "1.0.0",
      presets: {},
      servers: {}
    }));

    try {
      expect(() => loadRegistry(tmpReg)).toThrow("Unsupported registry schemaVersion");
    } finally {
      try { unlinkSync(tmpReg); } catch {}
    }
  });

  it("throws on invalid JSON in registry", () => {
    const tmpReg = resolve(tmpdir(), `test-reg-invalid-${Date.now()}.json`);
    writeFileSync(tmpReg, "{ invalid");

    try {
      expect(() => loadRegistry(tmpReg)).toThrow("Invalid JSON");
    } finally {
      try { unlinkSync(tmpReg); } catch {}
    }
  });
});
