import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkServerBinary, runDoctor } from "../src/doctor.js";
import { cpOps } from "../src/cp-utils.js";

describe("doctor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("missing binary -> MISSING_BINARY", async () => {
    vi.spyOn(cpOps, "execSync").mockImplementation(() => {
      throw new Error("binary not found");
    });

    const res = await checkServerBinary({
      name: "nonexistent",
      command: "nonexistent-cmd",
      args: [],
    });

    expect(res.status).toBe("MISSING_BINARY");
    expect(res.detail).toContain("is not found in PATH");
  });

  it("missing required env -> MISSING_ENV", async () => {
    const res = await checkServerBinary({
      name: "postgres",
      command: "npx",
      args: ["@modelcontextprotocol/server-postgres"],
      requiredEnv: ["NONEXISTENT_POSTGRES_TEST_ENV"],
    });

    expect(res.status).toBe("MISSING_ENV");
    expect(res.detail).toContain("Missing required environment variable(s)");
  });

  it("happy path -> OK via binary --version", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "1.0.0\n", "");
      return {} as any;
    });

    const res = await checkServerBinary({
      name: "node-server",
      command: "node",
      args: ["--version"],
    });

    expect(res.status).toBe("OK");
  });

  it("hang / timeout -> TIMEOUT", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      const error: any = new Error("Command aborted");
      error.name = "AbortError";
      callback(error, "", "");
      return {} as any;
    });

    const res = await checkServerBinary(
      {
        name: "hanging-server",
        command: "sleep",
        args: ["100"],
      },
      100
    );

    expect(res.status).toBe("TIMEOUT");
  });

  it("runs doctor against full config format", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "2.0.0\n", "");
      return {} as any;
    });

    const config = {
      mcp: {
        git: {
          type: "local",
          command: ["uvx", "mcp-server-git"],
          enabled: true,
        },
      },
    };

    const results = await runDoctor(config);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("git");
    expect(results[0].status).toBe("OK");
  });
});
import { EventEmitter } from "node:events";

describe("doctor handshake and edge cases", () => {
  it("bad version output falls back to mcp handshake", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      // Empty stdout for version
      callback(null, "", "");
      return {} as any;
    });

    const fakeProc: any = new EventEmitter();
    fakeProc.stdin = { write: vi.fn(), end: vi.fn() };
    fakeProc.stdout = new EventEmitter();
    fakeProc.kill = vi.fn();

    vi.spyOn(cpOps, "spawn").mockReturnValue(fakeProc);

    const checkPromise = checkServerBinary({
      name: "handshake-server",
      command: "my-handshake-bin",
      args: [],
    }, 2000);

    setTimeout(() => {
      fakeProc.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","result":{}}'));
    }, 10);

    const res = await checkPromise;
    expect(res.status).toBe("OK");
  });

  it("handshake fails when proc emits error", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "", "");
      return {} as any;
    });

    const fakeProc: any = new EventEmitter();
    fakeProc.stdin = { write: vi.fn(), end: vi.fn() };
    fakeProc.stdout = new EventEmitter();
    fakeProc.kill = vi.fn();

    vi.spyOn(cpOps, "spawn").mockReturnValue(fakeProc);

    const checkPromise = checkServerBinary({
      name: "err-server",
      command: "err-bin",
      args: [],
    }, 2000);

    setTimeout(() => {
      fakeProc.emit("error", new Error("Spawn failure"));
    }, 10);

    const res = await checkPromise;
    expect(res.status).toBe("HANDSHAKE_FAILED");
  });

  it("handshake fails when proc exits with non-zero code", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "", "");
      return {} as any;
    });

    const fakeProc: any = new EventEmitter();
    fakeProc.stdin = { write: vi.fn(), end: vi.fn() };
    fakeProc.stdout = new EventEmitter();
    fakeProc.kill = vi.fn();

    vi.spyOn(cpOps, "spawn").mockReturnValue(fakeProc);

    const checkPromise = checkServerBinary({
      name: "close-server",
      command: "close-bin",
      args: [],
    }, 2000);

    setTimeout(() => {
      fakeProc.emit("close", 1);
    }, 10);

    const res = await checkPromise;
    expect(res.status).toBe("HANDSHAKE_FAILED");
  });

  it("runs doctor against claude mcpServers format", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "1.0.0\n", "");
      return {} as any;
    });

    const config = {
      mcpServers: {
        git: {
          command: "uvx",
          args: ["mcp-server-git"],
          env: {},
        },
      },
    };

    const results = await runDoctor(config);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("git");
    expect(results[0].status).toBe("OK");
  });
});
describe("doctor branch coverage", () => {
  it("reports ok when handshake exits cleanly with code 0", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "", "");
      return {} as any;
    });

    const fakeProc: any = new EventEmitter();
    fakeProc.stdin = { write: vi.fn(), end: vi.fn() };
    fakeProc.stdout = new EventEmitter();
    fakeProc.kill = vi.fn();

    vi.spyOn(cpOps, "spawn").mockReturnValue(fakeProc);

    const checkPromise = checkServerBinary({
      name: "clean-close-server",
      command: "clean-close-bin",
      args: [],
    }, 2000);

    setTimeout(() => {
      fakeProc.emit("close", 0);
    }, 10);

    const res = await checkPromise;
    expect(res.status).toBe("OK");
  });

  it("reports handshake timeout when handshake stalls", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "", "");
      return {} as any;
    });

    const fakeProc: any = new EventEmitter();
    fakeProc.stdin = { write: vi.fn(), end: vi.fn() };
    fakeProc.stdout = new EventEmitter();
    fakeProc.kill = vi.fn();

    vi.spyOn(cpOps, "spawn").mockReturnValue(fakeProc);

    const res = await checkServerBinary({
      name: "timeout-handshake-server",
      command: "stalled-bin",
      args: [],
    }, 50);

    expect(res.status).toBe("TIMEOUT");
  });
});
describe("doctor additional branches", () => {
  it("checkServerBinary handles empty environment object and fallback to process.env", async () => {
    process.env.TEST_EXISTING_ENV = "value";
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "1.0.0", "");
      return {} as any;
    });

    const res = await checkServerBinary({
      name: "env-server",
      command: "node",
      args: [],
      requiredEnv: ["TEST_EXISTING_ENV"],
    });

    expect(res.status).toBe("OK");
    delete process.env.TEST_EXISTING_ENV;
  });

  it("checkServerBinary handles handshake failure on close with non-result buffer", async () => {
    vi.spyOn(cpOps, "execSync").mockReturnValue(Buffer.from("") as any);
    vi.spyOn(cpOps, "exec").mockImplementation((cmd: any, opts: any, callback: any) => {
      callback(null, "", "");
      return {} as any;
    });

    const fakeProc: any = new EventEmitter();
    fakeProc.stdin = { write: vi.fn(), end: vi.fn() };
    fakeProc.stdout = new EventEmitter();
    fakeProc.kill = vi.fn();

    vi.spyOn(cpOps, "spawn").mockReturnValue(fakeProc);

    const checkPromise = checkServerBinary({
      name: "bad-close-server",
      command: "bad-close-bin",
      args: [],
    }, 2000);

    setTimeout(() => {
      fakeProc.stdout.emit("data", Buffer.from("arbitrary log output\n"));
      fakeProc.emit("close", 1);
    }, 10);

    const res = await checkPromise;
    expect(res.status).toBe("HANDSHAKE_FAILED");
  });
});
