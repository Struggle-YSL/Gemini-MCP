import { existsSync } from "node:fs";
import {
  createInMemoryGeminiSessionStore,
  type GeminiSessionStore,
} from "./session-store.js";
import {
  configureLogger,
  log,
  type LoggerConfiguration,
} from "./gemini-runner-logging.js";
import { resolveProxyEnv, type ProxySource } from "./gemini-runner-proxy.js";
import {
  GeminiCliError,
  createMissingCliError,
  createSessionError,
  extractJsonPayload,
  getGeminiErrorMeta,
} from "./gemini-runner-errors.js";
import {
  assignNativeSessionId,
  buildSessionPrompt,
  cleanupFailedSession,
  getSessionSelection,
  pruneExpiredSessions,
  rememberSessionTurn,
} from "./gemini-runner-session.js";
import { GeminiAuthController } from "./gemini-runner-auth.js";
import { runOnce, type RunOptions } from "./gemini-runner-process.js";
import {
  resolveGemini,
  type GeminiResolution,
} from "./gemini-runner-discovery.js";

export interface GeminiOptions {
  /** Gemini 模型名称，不传则使用 gemini CLI 的默认模型 */
  model?: string;
  /** 超时时间（毫秒），默认 120000 */
  timeout?: number;
  /** 失败后重试次数，默认 1 */
  retries?: number;
  /** 可选，用于取消正在运行的 Gemini CLI 子进程 */
  signal?: AbortSignal;
}

export interface GeminiToolOptions extends GeminiOptions {
  /** MCP 会话 ID；优先映射到 Gemini 原生 session_id，失败时回退到当前进程内历史回放 */
  sessionId?: string;
}

export interface GeminiToolResult {
  text: string;
  sessionId: string;
  sessionReused: boolean;
}

interface GeminiJsonResult {
  sessionId: string | null;
  text: string;
}

const DEFAULT_GEMINI_TIMEOUT_MS = 120_000;
const AUTH_PROBE_PROMPT = "reply with: ok";

export const GEMINI = resolveGemini();
const authController = new GeminiAuthController();
let sessionStore: GeminiSessionStore = createInMemoryGeminiSessionStore();

export type { LoggerConfiguration, GeminiResolution };
export { configureLogger, getGeminiErrorMeta, log };

export function configureGeminiSessionStore(store: GeminiSessionStore): void {
  sessionStore = store;
}

const runAuthProbe = (execPath: string, timeoutMs: number): Promise<string> => {
  return runOnce(execPath, AUTH_PROBE_PROMPT, {
    timeout: timeoutMs,
    outputFormat: "text",
  });
};

export function ensureGeminiPath(): string {
  if (GEMINI.execPath && existsSync(GEMINI.execPath)) {
    return GEMINI.execPath;
  }

  Object.assign(GEMINI, resolveGemini());
  authController.reset();

  if (!GEMINI.execPath) {
    throw createMissingCliError(GEMINI.searchedPaths);
  }

  return GEMINI.execPath;
}

export function getRuntimeDiagnostics(): {
  proxySource: ProxySource;
  activeSessions: number;
} {
  pruneExpiredSessions(sessionStore);
  return {
    proxySource: resolveProxyEnv().source,
    activeSessions: sessionStore.size(),
  };
}

export async function runGeminiTool(
  toolName: string,
  prompt: string,
  options: GeminiToolOptions = {},
): Promise<GeminiToolResult> {
  const { sessionId, ...geminiOptions } = options;
  const selection = getSessionSelection(sessionStore, sessionId);
  const resumeSessionId =
    selection.session.nativeSessionId ??
    (selection.reused ? selection.session.id : undefined);

  try {
    const nativeResult = await runGeminiWithJsonOutput(prompt, {
      ...geminiOptions,
      sessionId: selection.reused ? resumeSessionId : undefined,
    });

    assignNativeSessionId(
      sessionStore,
      selection.session,
      nativeResult.sessionId,
    );
    rememberSessionTurn(
      sessionStore,
      selection.session,
      toolName,
      prompt,
      nativeResult.text,
    );

    return {
      text: nativeResult.text,
      sessionId: selection.session.id,
      sessionReused: selection.reused,
    };
  } catch (error) {
    const meta = getGeminiErrorMeta(error);
    const canFallbackToReplay =
      meta.kind === "session" && selection.session.turns.length > 0;

    if (canFallbackToReplay) {
      log(
        "warn",
        "Gemini native session resume failed, falling back to in-memory replay",
        {
          toolName,
          sessionId: selection.session.id,
          error: meta.message,
        },
      );

      const effectivePrompt = buildSessionPrompt(
        prompt,
        toolName,
        selection.session,
      );
      const text = await runGemini(effectivePrompt, geminiOptions);
      rememberSessionTurn(
        sessionStore,
        selection.session,
        toolName,
        prompt,
        text,
      );

      return {
        text,
        sessionId: selection.session.id,
        sessionReused: selection.reused,
      };
    }

    if (meta.kind === "session" && selection.externalLookup) {
      cleanupFailedSession(sessionStore, selection);
      throw createSessionError(selection.session.id);
    }

    cleanupFailedSession(sessionStore, selection);
    log("error", "Gemini MCP tool failed", {
      toolName,
      kind: meta.kind,
      retryable: meta.retryable,
      error: meta.message,
      sessionId: selection.session.id,
      sessionReused: selection.reused,
    });
    throw error;
  }
}

export async function runGemini(
  prompt: string,
  options: GeminiOptions = {},
): Promise<string> {
  const execPath = ensureGeminiPath();
  const {
    model,
    timeout = DEFAULT_GEMINI_TIMEOUT_MS,
    retries = 1,
    signal,
  } = options;
  signal?.throwIfAborted();
  authController.ensureAuth(execPath, runAuthProbe);
  return runWithRetry(
    execPath,
    prompt,
    { model, timeout, outputFormat: "text", signal },
    retries,
  );
}

async function runGeminiWithJsonOutput(
  prompt: string,
  options: GeminiOptions & { sessionId?: string } = {},
): Promise<GeminiJsonResult> {
  const execPath = ensureGeminiPath();
  const {
    model,
    timeout = DEFAULT_GEMINI_TIMEOUT_MS,
    retries = 1,
    sessionId,
    signal,
  } = options;
  signal?.throwIfAborted();
  authController.ensureAuth(execPath, runAuthProbe);
  const raw = await runWithRetry(
    execPath,
    prompt,
    {
      model,
      timeout,
      outputFormat: "json",
      resumeSessionId: sessionId,
      signal,
    },
    retries,
  );
  const payload = extractJsonPayload(raw);

  return {
    sessionId: payload.session_id ?? sessionId ?? null,
    text: payload.response ?? "",
  };
}

async function runWithRetry(
  execPath: string,
  prompt: string,
  options: RunOptions,
  remaining: number,
): Promise<string> {
  try {
    const result = await runOnce(execPath, prompt, options);
    authController.markAuthenticated(execPath);
    return result;
  } catch (error) {
    const meta = getGeminiErrorMeta(error);
    if (meta.kind === "auth") {
      authController.markUnauthenticated(execPath);
    }

    const retryable = !(error instanceof GeminiCliError) || error.retryable;
    if (remaining > 0 && retryable) {
      log("warn", "Gemini CLI failed, retrying...", {
        remaining,
        kind: meta.kind,
        retryable: meta.retryable,
        error: meta.message,
      });
      return runWithRetry(execPath, prompt, options, remaining - 1);
    }

    throw error;
  }
}
