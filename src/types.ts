export type Runtime = "npx" | "uvx" | "docker" | "binary";
export type SchemaFormat = "opencode" | "claude" | "unknown";

export interface ServerSpec {
  description: string;
  runtime: Runtime;
  command: string;
  args: string[];
  requiredEnv: string[];
  optionalEnv: string[];
  comingSoon?: boolean;
}

export interface Registry {
  schemaVersion: string;
  minCliVersion: string;
  presets: Record<string, string[]>;
  servers: Record<string, ServerSpec>;
}

export interface RuntimeStatus {
  node: { present: boolean; version?: string };
  npx: { present: boolean; version?: string };
  uvx: { present: boolean; version?: string };
  docker: { present: boolean; version?: string };
}

export interface DetectedSchema {
  format: SchemaFormat;
  source: "user-flag" | "binary-probe" | "source-inspect" | "fallback";
  path?: string;
}

export type DoctorStatus =
  | "OK"
  | "MISSING_BINARY"
  | "MISSING_ENV"
  | "BAD_VERSION"
  | "TIMEOUT"
  | "HANDSHAKE_FAILED";

export interface DoctorResult {
  name: string;
  status: DoctorStatus;
  detail?: string;
}
