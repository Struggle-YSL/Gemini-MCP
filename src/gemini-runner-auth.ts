import {
  createAuthError,
  getGeminiErrorMeta,
  isAuthFailure,
} from "./gemini-runner-errors.js";
import { log } from "./gemini-runner-logging.js";

interface AuthCheckCache {
  execPath: string;
  status: "authenticated" | "unauthenticated" | "unknown";
  nextProbeAt: number;
}

type GeminiAuthProbeRunner = (
  execPath: string,
  timeoutMs: number,
) => Promise<string>;

const DEFAULT_AUTH_PROBE_TIMEOUT_MS = 30_000;
const AUTH_PROBE_BACKOFF_MS = 10 * 60 * 1000;

export interface GeminiAuthControllerOptions {
  authProbeTimeoutMs?: number;
  authProbeBackoffMs?: number;
}

export class GeminiAuthController {
  private authCheckCache: AuthCheckCache | null = null;
  private authProbePromise: Promise<void> | null = null;
  private authProbeExecPath: string | null = null;

  private readonly authProbeTimeoutMs: number;
  private readonly authProbeBackoffMs: number;

  constructor(options: GeminiAuthControllerOptions = {}) {
    this.authProbeTimeoutMs =
      options.authProbeTimeoutMs ?? DEFAULT_AUTH_PROBE_TIMEOUT_MS;
    this.authProbeBackoffMs =
      options.authProbeBackoffMs ?? AUTH_PROBE_BACKOFF_MS;
  }

  reset(): void {
    this.authCheckCache = null;
    this.authProbePromise = null;
    this.authProbeExecPath = null;
  }

  markAuthenticated(execPath: string): void {
    this.authCheckCache = {
      execPath,
      status: "authenticated",
      nextProbeAt: Number.POSITIVE_INFINITY,
    };
  }

  markUnauthenticated(execPath: string): void {
    this.authCheckCache = {
      execPath,
      status: "unauthenticated",
      nextProbeAt: Date.now() + this.authProbeBackoffMs,
    };
  }

  ensureAuth(execPath: string, runProbe: GeminiAuthProbeRunner): void {
    const now = Date.now();
    if (this.authCheckCache?.execPath === execPath) {
      if (this.authCheckCache.status === "authenticated") {
        return;
      }

      if (
        this.authCheckCache.status === "unauthenticated" &&
        this.authCheckCache.nextProbeAt > now
      ) {
        throw createAuthError();
      }

      if (this.authCheckCache.nextProbeAt > now) {
        return;
      }
    }

    this.startProbe(execPath, runProbe);
  }

  private deferProbe(execPath: string): void {
    this.authCheckCache = {
      execPath,
      status: "unknown",
      nextProbeAt: Date.now() + this.authProbeBackoffMs,
    };
  }

  private startProbe(execPath: string, runProbe: GeminiAuthProbeRunner): void {
    if (this.authProbePromise && this.authProbeExecPath === execPath) {
      return;
    }

    this.authProbeExecPath = execPath;
    this.authProbePromise = (async () => {
      try {
        const output = await runProbe(execPath, this.authProbeTimeoutMs);
        if (/\bok\b/i.test(output)) {
          this.markAuthenticated(execPath);
          return;
        }

        if (isAuthFailure(output)) {
          this.markUnauthenticated(execPath);
          log("warn", "Gemini auth preflight detected unauthenticated CLI", {
            execPath,
            output,
          });
          return;
        }

        this.deferProbe(execPath);
        log("warn", "Gemini auth preflight returned inconclusive output", {
          execPath,
          output,
        });
      } catch (error) {
        const meta = getGeminiErrorMeta(error);
        if (meta.kind === "auth") {
          this.markUnauthenticated(execPath);
          log("warn", "Gemini auth preflight detected unauthenticated CLI", {
            execPath,
            kind: meta.kind,
            error: meta.message,
          });
          return;
        }

        this.deferProbe(execPath);
        log("warn", "Gemini auth preflight skipped due to inconclusive probe", {
          execPath,
          kind: meta.kind,
          error: meta.message,
        });
      } finally {
        this.authProbePromise = null;
        this.authProbeExecPath = null;
      }
    })();
  }
}
