export type LogLevel = "info" | "warn" | "error";

export interface RuntimeConfig {
  dbPath?: string;
  maxActiveOrchestrators: number;
  orchestratorTickMs: number;
  orchestratorMaxGeminiRetries: number;
  maxFrontendTasks: number;
  processTerminationGraceMs: number;
  processTerminationForceWaitMs: number;
  logLevel: LogLevel;
}

const DEFAULT_MAX_ACTIVE_ORCHESTRATORS = 2;
const DEFAULT_ORCHESTRATOR_TICK_MS = 1500;
const DEFAULT_ORCHESTRATOR_MAX_GEMINI_RETRIES = 2;
const DEFAULT_MAX_FRONTEND_TASKS = 2;
const DEFAULT_PROCESS_TERMINATION_GRACE_MS = 1500;
const DEFAULT_PROCESS_TERMINATION_FORCE_WAIT_MS = 1000;
const DEFAULT_LOG_LEVEL: LogLevel = "info";

function readNonEmptyEnvValue(
  env: NodeJS.ProcessEnv,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseIntegerWithBounds(
  raw: string | undefined,
  fallback: number,
  options: { min?: number; max?: number } = {}
): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  let value = parsed;
  if (typeof options.min === "number" && value < options.min) {
    value = options.min;
  }
  if (typeof options.max === "number" && value > options.max) {
    value = options.max;
  }
  return value;
}

function parseLogLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return fallback;
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    dbPath: readNonEmptyEnvValue(env, "GEMINI_MCP_DB_PATH"),
    maxActiveOrchestrators: parseIntegerWithBounds(
      readNonEmptyEnvValue(env, "GEMINI_MCP_MAX_ACTIVE_ORCHESTRATORS"),
      DEFAULT_MAX_ACTIVE_ORCHESTRATORS,
      { min: 1 },
    ),
    orchestratorTickMs: parseIntegerWithBounds(
      readNonEmptyEnvValue(env, "GEMINI_MCP_ORCHESTRATOR_TICK_MS"),
      DEFAULT_ORCHESTRATOR_TICK_MS,
      { min: 1 },
    ),
    orchestratorMaxGeminiRetries: parseIntegerWithBounds(
      readNonEmptyEnvValue(env, "GEMINI_MCP_ORCHESTRATOR_MAX_GEMINI_RETRIES"),
      DEFAULT_ORCHESTRATOR_MAX_GEMINI_RETRIES,
      { min: 0 },
    ),
    maxFrontendTasks: parseIntegerWithBounds(
      readNonEmptyEnvValue(env, "GEMINI_MCP_MAX_FRONTEND_TASKS", "GEMINI_MCP_MAX_CONCURRENT_TASKS"),
      DEFAULT_MAX_FRONTEND_TASKS,
      { min: 1 },
    ),
    processTerminationGraceMs: parseIntegerWithBounds(
      readNonEmptyEnvValue(env, "GEMINI_MCP_PROCESS_TERMINATION_GRACE_MS"),
      DEFAULT_PROCESS_TERMINATION_GRACE_MS,
      { min: 1 },
    ),
    processTerminationForceWaitMs: parseIntegerWithBounds(
      readNonEmptyEnvValue(env, "GEMINI_MCP_PROCESS_TERMINATION_FORCE_WAIT_MS"),
      DEFAULT_PROCESS_TERMINATION_FORCE_WAIT_MS,
      { min: 1 },
    ),
    logLevel: parseLogLevel(
      readNonEmptyEnvValue(env, "GEMINI_MCP_LOG_LEVEL"),
      DEFAULT_LOG_LEVEL,
    ),
  };
}

export const RUNTIME_CONFIG = resolveRuntimeConfig();
