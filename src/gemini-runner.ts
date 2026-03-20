import { randomUUID } from "node:crypto";
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

export interface GeminiOptions {
  /** Gemini 模型名称，不传则使用 gemini CLI 的默认模型 */
  model?: string;
  /** 超时时间（毫秒），默认 120000 */
  timeout?: number;
  /** 失败后重试次数，默认 1 */
  retries?: number;
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

export interface GeminiResolution {
  /** gemini 可执行文件完整路径，找不到时为 null */
  execPath: string | null;
  /** npm global bin 目录 */
  globalBinDir: string;
}

type ProxySource = "env" | "windows-registry" | "none";
type GeminiErrorKind = "missing-cli" | "auth" | "timeout" | "network" | "unknown-exit" | "spawn" | "session";
type OutputFormat = "text" | "json";

interface RunOptions {
  model?: string;
  timeout: number;
  outputFormat?: OutputFormat;
  resumeSessionId?: string;
}

interface AuthCheckCache {
  execPath: string;
  status: "authenticated" | "unauthenticated" | "unknown";
  nextProbeAt: number;
}

interface SessionTurn {
  toolName: string;
  prompt: string;
  response: string;
  ts: number;
}

interface SessionState {
  id: string;
  nativeSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  turns: SessionTurn[];
}

interface SessionSelection {
  created: boolean;
  reused: boolean;
  externalLookup: boolean;
  session: SessionState;
}

interface GeminiJsonResult {
  sessionId: string | null;
  text: string;
}

interface GeminiJsonPayload {
  session_id?: string;
  response?: string;
}

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SESSION_HISTORY_TURNS = 4;
const SESSION_STORE_TURNS = 12;
const SESSION_CHAR_BUDGET = 48_000;
const DEFAULT_GEMINI_TIMEOUT_MS = 120_000;
const DEFAULT_AUTH_PROBE_TIMEOUT_MS = 30_000;
const AUTH_PROBE_BACKOFF_MS = 10 * 60 * 1000;

class GeminiCliError extends Error {
  kind: GeminiErrorKind;
  retryable: boolean;

  constructor(kind: GeminiErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = "GeminiCliError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

function resolveGemini(): GeminiResolution {
  if (process.env.GEMINI_PATH) {
    const p = process.env.GEMINI_PATH;
    if (existsSync(p)) {
      return { execPath: p, globalBinDir: path.dirname(p) };
    }
  }

  const npmCommands = process.platform === "win32"
    ? ["npm.cmd", "npm"]
    : ["npm"];

  for (const npmCmd of npmCommands) {
    try {
      const prefix = execSync(`${npmCmd} config get prefix`, {
        encoding: "utf8",
        timeout: 5000,
      }).trim();

      const globalBinDir = process.platform === "win32"
        ? prefix
        : path.join(prefix, "bin");

      const candidates = process.platform === "win32"
        ? [
            path.join(globalBinDir, "gemini.cmd"),
            path.join(globalBinDir, "gemini.exe"),
            path.join(globalBinDir, "gemini"),
          ]
        : [path.join(globalBinDir, "gemini")];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return { execPath: candidate, globalBinDir };
        }
      }
    } catch {
      // 继续尝试下一个
    }
  }

  if (process.platform === "win32") {
    const fallbackDirs = [
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "",
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm") : "",
    ].filter(Boolean);

    for (const dir of fallbackDirs) {
      for (const name of ["gemini.cmd", "gemini.exe", "gemini"]) {
        const candidate = path.join(dir, name);
        if (existsSync(candidate)) {
          return { execPath: candidate, globalBinDir: dir };
        }
      }
    }
  }

  return { execPath: null, globalBinDir: "" };
}

export const GEMINI = resolveGemini();
let authCheckCache: AuthCheckCache | null = null;
let authProbePromise: Promise<void> | null = null;
let authProbeExecPath: string | null = null;
const sessionStore = new Map<string, SessionState>();

function markGeminiAuthenticated(execPath: string): void {
  authCheckCache = {
    execPath,
    status: "authenticated",
    nextProbeAt: Number.POSITIVE_INFINITY,
  };
}

function markGeminiUnauthenticated(execPath: string): void {
  authCheckCache = {
    execPath,
    status: "unauthenticated",
    nextProbeAt: Date.now() + AUTH_PROBE_BACKOFF_MS,
  };
}

function deferGeminiAuthProbe(execPath: string): void {
  authCheckCache = {
    execPath,
    status: "unknown",
    nextProbeAt: Date.now() + AUTH_PROBE_BACKOFF_MS,
  };
}

function startGeminiAuthProbe(execPath: string): void {
  if (authProbePromise && authProbeExecPath === execPath) {
    return;
  }

  authProbeExecPath = execPath;
  authProbePromise = (async () => {
    try {
      const output = await runOnce(execPath, "reply with: ok", { timeout: DEFAULT_AUTH_PROBE_TIMEOUT_MS, outputFormat: "text" });
      if (/\bok\b/i.test(output)) {
        markGeminiAuthenticated(execPath);
        return;
      }

      if (isAuthFailure(output)) {
        markGeminiUnauthenticated(execPath);
        log("warn", "Gemini auth preflight detected unauthenticated CLI", {
          execPath,
          output,
        });
        return;
      }

      deferGeminiAuthProbe(execPath);
      log("warn", "Gemini auth preflight returned inconclusive output", {
        execPath,
        output,
      });
    } catch (error) {
      const meta = getGeminiErrorMeta(error);
      if (meta.kind === "auth") {
        markGeminiUnauthenticated(execPath);
        log("warn", "Gemini auth preflight detected unauthenticated CLI", {
          execPath,
          kind: meta.kind,
          error: meta.message,
        });
        return;
      }

      deferGeminiAuthProbe(execPath);
      log("warn", "Gemini auth preflight skipped due to inconclusive probe", {
        execPath,
        kind: meta.kind,
        error: meta.message,
      });
    } finally {
      authProbePromise = null;
      authProbeExecPath = null;
    }
  })();
}

export function ensureGeminiPath(): string {
  if (GEMINI.execPath && existsSync(GEMINI.execPath)) {
    return GEMINI.execPath;
  }

  Object.assign(GEMINI, resolveGemini());
  authCheckCache = null;
  authProbePromise = null;
  authProbeExecPath = null;

  if (!GEMINI.execPath) {
    throw createMissingCliError();
  }

  return GEMINI.execPath;
}

function pickEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeProxyUrl(value: string): string {
  return /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
}

function parseWindowsProxyServer(raw: string): { httpProxy?: string; httpsProxy?: string } {
  const value = raw.trim();
  if (!value) {
    return {};
  }

  if (!value.includes("=")) {
    const normalized = normalizeProxyUrl(value);
    return { httpProxy: normalized, httpsProxy: normalized };
  }

  const entries = Object.fromEntries(
    value
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [protocol, address] = item.split("=", 2);
        return [protocol.toLowerCase(), normalizeProxyUrl(address)];
      })
  );

  const httpProxy = entries.http ?? entries.https;
  const httpsProxy = entries.https ?? entries.http;
  return { httpProxy, httpsProxy };
}

function resolveWindowsRegistryProxy(): { httpProxy?: string; httpsProxy?: string } {
  if (process.platform !== "win32") {
    return {};
  }

  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled = execSync(`reg query "${key}" /v ProxyEnable`, {
      encoding: "utf8",
      timeout: 5000,
    });

    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) {
      return {};
    }

    const server = execSync(`reg query "${key}" /v ProxyServer`, {
      encoding: "utf8",
      timeout: 5000,
    });

    const match = server.match(/ProxyServer\s+REG_\w+\s+([^\r\n]+)/i);
    return match ? parseWindowsProxyServer(match[1]) : {};
  } catch {
    return {};
  }
}

function resolveProxyEnv(): {
  env: Record<string, string>;
  source: ProxySource;
} {
  const envHttpProxy = pickEnv("HTTP_PROXY", "http_proxy");
  const envHttpsProxy = pickEnv("HTTPS_PROXY", "https_proxy");

  if (envHttpProxy || envHttpsProxy) {
    const httpProxy = envHttpProxy ?? envHttpsProxy!;
    const httpsProxy = envHttpsProxy ?? envHttpProxy!;
    return {
      source: "env",
      env: {
        HTTP_PROXY: httpProxy,
        http_proxy: httpProxy,
        HTTPS_PROXY: httpsProxy,
        https_proxy: httpsProxy,
      },
    };
  }

  const windowsProxy = resolveWindowsRegistryProxy();
  if (windowsProxy.httpProxy || windowsProxy.httpsProxy) {
    const httpProxy = windowsProxy.httpProxy ?? windowsProxy.httpsProxy!;
    const httpsProxy = windowsProxy.httpsProxy ?? windowsProxy.httpProxy!;
    return {
      source: "windows-registry",
      env: {
        HTTP_PROXY: httpProxy,
        http_proxy: httpProxy,
        HTTPS_PROXY: httpsProxy,
        https_proxy: httpsProxy,
      },
    };
  }

  return { source: "none", env: {} };
}

function isAuthFailure(text: string): boolean {
  return /(sign in|signin|authenticate|authentication|log in|login|google account|oauth)/i.test(text);
}

function isNetworkFailure(text: string): boolean {
  return /(proxy|econnreset|enotfound|timed out|timeout|network|socket hang up|tls|certificate)/i.test(text);
}

function isInvalidSessionFailure(text: string): boolean {
  return /(invalid session identifier|error resuming session)/i.test(text);
}

function createMissingCliError(): GeminiCliError {
  return new GeminiCliError(
    "missing-cli",
    `gemini CLI not found in ${GEMINI.globalBinDir}. Please install: npm install -g @google/gemini-cli, then run: gemini (to complete auth)`,
    false
  );
}

function createAuthError(): GeminiCliError {
  return new GeminiCliError(
    "auth",
    "Gemini CLI authentication is required. Run `gemini` in a terminal and complete sign-in, then retry.",
    false
  );
}

function createSessionError(sessionId: string): GeminiCliError {
  return new GeminiCliError(
    "session",
    `Unknown session_id: ${sessionId}. Native Gemini session resume failed and there is no usable in-memory fallback for this session.`,
    false
  );
}

function createJsonParseError(raw: string): GeminiCliError {
  return new GeminiCliError(
    "unknown-exit",
    `Gemini CLI returned non-JSON output while JSON was expected: ${raw}`,
    true
  );
}

function createTimeoutError(timeout: number, proxySource: ProxySource): GeminiCliError {
  const proxyHint = proxySource === "none"
    ? " If your network requires a proxy, pass HTTPS_PROXY/HTTP_PROXY to the MCP server process."
    : "";
  return new GeminiCliError(
    "timeout",
    `Gemini CLI timed out after ${timeout}ms.${proxyHint} Consider retrying with a longer timeout.`,
    true
  );
}

function createExitError(code: number | null, stdout: string, stderr: string): GeminiCliError {
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

function createSpawnError(message: string): GeminiCliError {
  return new GeminiCliError(
    "spawn",
    `Failed to spawn gemini: ${message}`,
    false
  );
}

function pruneExpiredSessions(now = Date.now()): void {
  for (const [id, session] of sessionStore) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessionStore.delete(id);
    }
  }
}

function createSessionState(id: string = randomUUID(), nativeSessionId: string | null = null): SessionState {
  const now = Date.now();
  const session: SessionState = {
    id,
    nativeSessionId,
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
  sessionStore.set(id, session);
  return session;
}

function getSessionSelection(sessionId?: string): SessionSelection {
  pruneExpiredSessions();

  if (!sessionId) {
    return {
      created: true,
      reused: false,
      externalLookup: false,
      session: createSessionState(),
    };
  }

  const existing = sessionStore.get(sessionId);
  if (existing) {
    existing.updatedAt = Date.now();
    return {
      created: false,
      reused: true,
      externalLookup: false,
      session: existing,
    };
  }

  return {
    created: true,
    reused: true,
    externalLookup: true,
    session: createSessionState(sessionId, sessionId),
  };
}

function assignNativeSessionId(session: SessionState, nativeSessionId: string | null): void {
  if (!nativeSessionId) {
    return;
  }

  const previousId = session.id;
  session.nativeSessionId = nativeSessionId;
  session.id = nativeSessionId;
  session.updatedAt = Date.now();

  if (previousId !== nativeSessionId) {
    sessionStore.delete(previousId);
    sessionStore.set(nativeSessionId, session);
  }
}

function formatSessionTurn(turn: SessionTurn, index: number): string {
  return [
    `Turn ${index}`,
    `Tool: ${turn.toolName}`,
    "User Request:",
    turn.prompt,
    "Assistant Response:",
    turn.response,
  ].join("\n");
}

function buildSessionPrompt(prompt: string, toolName: string, session: SessionState): string {
  if (session.turns.length === 0) {
    return prompt;
  }

  const selected: string[] = [];
  let totalChars = 0;
  let turnNumber = session.turns.length;

  for (let i = session.turns.length - 1; i >= 0; i -= 1) {
    const turnText = formatSessionTurn(session.turns[i], turnNumber);
    if (selected.length > 0 && totalChars + turnText.length > SESSION_CHAR_BUDGET) {
      break;
    }

    selected.unshift(turnText);
    totalChars += turnText.length;
    turnNumber -= 1;

    if (selected.length >= SESSION_HISTORY_TURNS) {
      break;
    }
  }

  return [
    "You are continuing an existing Gemini MCP session.",
    `Current tool: ${toolName}`,
    "Use the previous exchanges as authoritative context and keep the response consistent with them.",
    "--- Session History ---",
    selected.join("\n\n"),
    "-----------------------",
    "Current request:",
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function rememberSessionTurn(session: SessionState, toolName: string, prompt: string, response: string): void {
  session.turns.push({
    toolName,
    prompt,
    response,
    ts: Date.now(),
  });

  if (session.turns.length > SESSION_STORE_TURNS) {
    session.turns.splice(0, session.turns.length - SESSION_STORE_TURNS);
  }

  session.updatedAt = Date.now();
}

function cleanupFailedSession(selection: SessionSelection): void {
  if (selection.created && selection.session.turns.length === 0) {
    sessionStore.delete(selection.session.id);
  }
}

function extractJsonPayload(raw: string): GeminiJsonPayload {
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

export function getRuntimeDiagnostics(): { proxySource: ProxySource; activeSessions: number } {
  pruneExpiredSessions();
  return {
    proxySource: resolveProxyEnv().source,
    activeSessions: sessionStore.size,
  };
}

export async function runGeminiTool(
  toolName: string,
  prompt: string,
  options: GeminiToolOptions = {}
): Promise<GeminiToolResult> {
  const { sessionId, ...geminiOptions } = options;
  const selection = getSessionSelection(sessionId);
  const nativeResumeId = selection.session.nativeSessionId ?? (selection.reused ? selection.session.id : undefined);

  try {
    const nativeResult = await runGeminiJson(prompt, {
      ...geminiOptions,
      sessionId: selection.reused ? nativeResumeId : undefined,
    });

    assignNativeSessionId(selection.session, nativeResult.sessionId);
    rememberSessionTurn(selection.session, toolName, prompt, nativeResult.text);

    return {
      text: nativeResult.text,
      sessionId: selection.session.id,
      sessionReused: selection.reused,
    };
  } catch (error) {
    const meta = getGeminiErrorMeta(error);
    const canFallbackToReplay = meta.kind === "session" && selection.session.turns.length > 0;

    if (canFallbackToReplay) {
      log("warn", "Gemini native session resume failed, falling back to in-memory replay", {
        toolName,
        sessionId: selection.session.id,
        error: meta.message,
      });

      const effectivePrompt = buildSessionPrompt(prompt, toolName, selection.session);
      const text = await runGemini(effectivePrompt, geminiOptions);
      rememberSessionTurn(selection.session, toolName, prompt, text);

      return {
        text,
        sessionId: selection.session.id,
        sessionReused: selection.reused,
      };
    }

    if (meta.kind === "session" && selection.externalLookup) {
      cleanupFailedSession(selection);
      throw createSessionError(selection.session.id);
    }

    cleanupFailedSession(selection);
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
  options: GeminiOptions = {}
): Promise<string> {
  const execPath = ensureGeminiPath();
  const { model, timeout = DEFAULT_GEMINI_TIMEOUT_MS, retries = 1 } = options;
  await ensureGeminiAuth(execPath);
  return runWithRetry(execPath, prompt, { model, timeout, outputFormat: "text" }, retries);
}

async function runGeminiJson(
  prompt: string,
  options: GeminiOptions & { sessionId?: string } = {}
): Promise<GeminiJsonResult> {
  const execPath = ensureGeminiPath();
  const { model, timeout = DEFAULT_GEMINI_TIMEOUT_MS, retries = 1, sessionId } = options;
  await ensureGeminiAuth(execPath);
  const raw = await runWithRetry(execPath, prompt, {
    model,
    timeout,
    outputFormat: "json",
    resumeSessionId: sessionId,
  }, retries);
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
  remaining: number
): Promise<string> {
  try {
    const result = await runOnce(execPath, prompt, options);
    markGeminiAuthenticated(execPath);
    return result;
  } catch (err) {
    const meta = getGeminiErrorMeta(err);
    if (meta.kind === "auth") {
      markGeminiUnauthenticated(execPath);
    }

    const retryable = !(err instanceof GeminiCliError) || err.retryable;
    if (remaining > 0 && retryable) {
      log("warn", "Gemini CLI failed, retrying...", {
        remaining,
        kind: meta.kind,
        retryable: meta.retryable,
        error: meta.message,
      });
      return runWithRetry(execPath, prompt, options, remaining - 1);
    }
    throw err;
  }
}

async function ensureGeminiAuth(execPath: string): Promise<void> {
  const now = Date.now();
  if (authCheckCache?.execPath === execPath) {
    if (authCheckCache.status === "authenticated") {
      return;
    }

    if (authCheckCache.status === "unauthenticated" && authCheckCache.nextProbeAt > now) {
      throw createAuthError();
    }

    if (authCheckCache.nextProbeAt > now) {
      return;
    }
  }

  startGeminiAuthProbe(execPath);
}

function buildSpawnArgs(
  execPath: string,
  prompt: string,
  options: RunOptions
): { command: string; args: string[] } {
  const flatPrompt = prompt.replace(/\r?\n/g, " ").trim();

  const geminiArgs = [
    ...(options.resumeSessionId ? ["--resume", options.resumeSessionId] : []),
    ...(options.model ? ["-m", options.model] : []),
    "-p",
    flatPrompt,
    "--yolo",
    ...(options.outputFormat ? ["--output-format", options.outputFormat] : []),
  ];

  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/c", execPath, ...geminiArgs] };
  }

  return { command: execPath, args: geminiArgs };
}

function runOnce(execPath: string, prompt: string, options: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const { command, args } = buildSpawnArgs(execPath, prompt, options);
    const proxy = resolveProxyEnv();

    const proc = spawn(command, args, {
      env: { ...process.env, ...proxy.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(createTimeoutError(options.timeout, proxy.source));
    }, options.timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stripMarkdownCodeBlock(stdout.trim()));
      } else {
        reject(createExitError(code, stdout.trim(), stderr.trim()));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(createSpawnError(err.message));
    });
  });
}

function stripMarkdownCodeBlock(raw: string): string {
  const match = raw.match(/^```[\w]*\n([\s\S]*?)\n```$/m);
  return match ? match[1].trim() : raw;
}

export function log(level: "info" | "warn" | "error", message: string, meta?: object): void {
  console.error(JSON.stringify({ level, message, ts: Date.now(), ...meta }));
}




