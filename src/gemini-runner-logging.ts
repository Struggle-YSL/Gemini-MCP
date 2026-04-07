import { RUNTIME_CONFIG, type LogLevel } from "./config.js";

export interface LoggerConfiguration {
  level?: LogLevel | null;
  sink?: ((entry: Record<string, unknown>) => void) | null;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  info: 10,
  warn: 20,
  error: 30,
};

const DEFAULT_LOG_SINK = (entry: Record<string, unknown>): void => {
  console.error(JSON.stringify(entry));
};

let loggerLevelOverride: LogLevel | null = null;
let loggerSink: (entry: Record<string, unknown>) => void = DEFAULT_LOG_SINK;

function parseLogLevel(raw: string | undefined): LogLevel | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return null;
}

function isNodeTestRuntime(): boolean {
  return process.execArgv.includes("--test")
    || process.argv.includes("--test")
    || process.env.NODE_ENV === "test"
    || process.env.npm_lifecycle_event === "test"
    || typeof process.env.NODE_TEST_CONTEXT === "string";
}

function resolveEffectiveLogLevel(): LogLevel {
  if (loggerLevelOverride) {
    return loggerLevelOverride;
  }

  const envLevel = parseLogLevel(process.env.GEMINI_MCP_LOG_LEVEL);
  if (envLevel) {
    return envLevel;
  }

  if (isNodeTestRuntime()) {
    return "warn";
  }

  return RUNTIME_CONFIG.logLevel;
}

function shouldLog(level: LogLevel): boolean {
  const activeLevel = resolveEffectiveLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[activeLevel];
}

export function configureLogger(configuration: LoggerConfiguration = {}): void {
  if (configuration.level === null) {
    loggerLevelOverride = null;
  } else if (configuration.level) {
    loggerLevelOverride = configuration.level;
  }

  if (configuration.sink === null) {
    loggerSink = DEFAULT_LOG_SINK;
  } else if (configuration.sink) {
    loggerSink = configuration.sink;
  }
}

export function log(level: LogLevel, message: string, meta?: object): void {
  if (!shouldLog(level)) {
    return;
  }

  loggerSink({ level, message, ts: Date.now(), ...meta });
}
