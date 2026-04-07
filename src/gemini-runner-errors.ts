import type { ProxySource } from "./gemini-runner-proxy.js";

export type GeminiErrorKind =
  | "missing-cli"
  | "auth"
  | "timeout"
  | "network"
  | "unknown-exit"
  | "spawn"
  | "session"
  | "cancelled";

export interface GeminiJsonPayload {
  session_id?: string;
  response?: string;
}

export class GeminiCliError extends Error {
  kind: GeminiErrorKind;
  retryable: boolean;

  constructor(kind: GeminiErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = "GeminiCliError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

export function isAuthFailure(text: string): boolean {
  return /(sign in|signin|authenticate|authentication|log in|login|google account|oauth)/i.test(text);
}

function isNetworkFailure(text: string): boolean {
  return /(proxy|econnreset|enotfound|timed out|timeout|network|socket hang up|tls|certificate)/i.test(text);
}

function isInvalidSessionFailure(text: string): boolean {
  return /(invalid session identifier|error resuming session)/i.test(text);
}

export function createMissingCliError(globalBinDir: string): GeminiCliError {
  return new GeminiCliError(
    "missing-cli",
    `gemini CLI not found in ${globalBinDir}. Please install: npm install -g @google/gemini-cli, then run: gemini (to complete auth)`,
    false
  );
}

export function createAuthError(): GeminiCliError {
  return new GeminiCliError(
    "auth",
    "Gemini CLI authentication is required. Run `gemini` in a terminal and complete sign-in, then retry.",
    false
  );
}

export function createSessionError(sessionId: string): GeminiCliError {
  return new GeminiCliError(
    "session",
    `Unknown session_id: ${sessionId}. Native Gemini session resume failed and there is no usable in-memory fallback for this session.`,
    false
  );
}

export function createJsonParseError(raw: string): GeminiCliError {
  return new GeminiCliError(
    "unknown-exit",
    `Gemini CLI returned non-JSON output while JSON was expected: ${raw}`,
    true
  );
}

export function createCancelledError(reason?: unknown): GeminiCliError {
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "string" && reason
      ? reason
      : "Gemini CLI execution was cancelled.";

  return new GeminiCliError(
    "cancelled",
    message,
    false
  );
}

export function createTimeoutError(timeout: number, proxySource: ProxySource): GeminiCliError {
  const proxyHint = proxySource === "none"
    ? " If your network requires a proxy, pass HTTPS_PROXY/HTTP_PROXY to the MCP server process."
    : "";
  return new GeminiCliError(
    "timeout",
    `Gemini CLI timed out after ${timeout}ms.${proxyHint} Consider retrying with a longer timeout.`,
    true
  );
}

export function createExitError(code: number | null, stdout: string, stderr: string): GeminiCliError {
  const combined = `${stderr}\n${stdout}`.trim();

  if (isAuthFailure(combined)) {
    return new GeminiCliError(
      "auth",
      "Gemini CLI authentication is required. Run `gemini` in a terminal and complete sign-in, then retry.",
      false
    );
  }

  if (isInvalidSessionFailure(combined)) {
    return new GeminiCliError(
      "session",
      combined,
      false
    );
  }

  if (!combined) {
    return new GeminiCliError(
      "unknown-exit",
      `Gemini CLI exited with code ${code} without any stderr/stdout output. Retry the request; if it persists, run gemini manually to inspect the environment.`,
      true
    );
  }

  if (isNetworkFailure(combined)) {
    return new GeminiCliError(
      "network",
      `Gemini CLI failed with a network-related error: ${combined}`,
      true
    );
  }

  return new GeminiCliError(
    "unknown-exit",
    `Gemini CLI exited with code ${code}: ${combined}`,
    true
  );
}

export function createSpawnError(message: string): GeminiCliError {
  return new GeminiCliError(
    "spawn",
    `Failed to spawn gemini: ${message}`,
    false
  );
}

export function extractJsonPayload(raw: string): GeminiJsonPayload {
  const text = raw.trim();
  if (!text) {
    throw createJsonParseError(raw);
  }

  try {
    return JSON.parse(text) as GeminiJsonPayload;
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as GeminiJsonPayload;
      } catch {
        // fall through
      }
    }
    throw createJsonParseError(raw);
  }
}

export function getGeminiErrorMeta(error: unknown): {
  kind: GeminiErrorKind | "unknown";
  retryable: boolean | null;
  message: string;
} {
  if (error instanceof GeminiCliError) {
    return {
      kind: error.kind,
      retryable: error.retryable,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      kind: "unknown",
      retryable: null,
      message: error.message,
    };
  }

  return {
    kind: "unknown",
    retryable: null,
    message: String(error),
  };
}
