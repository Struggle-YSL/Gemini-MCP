import { spawn } from "node:child_process";
import { terminateProcessTree } from "./process-control.js";
import {
  createCancelledError,
  createExitError,
  createSpawnError,
  createTimeoutError,
  type GeminiCliError,
} from "./gemini-runner-errors.js";
import { log } from "./gemini-runner-logging.js";
import { resolveProxyEnv } from "./gemini-runner-proxy.js";

type OutputFormat = "text" | "json";

export interface RunOptions {
  model?: string;
  timeout: number;
  outputFormat?: OutputFormat;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

export function buildSpawnArgs(
  execPath: string,
  prompt: string,
  options: RunOptions,
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

export function runOnce(execPath: string, prompt: string, options: RunOptions): Promise<string> {
  options.signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const { command, args } = buildSpawnArgs(execPath, prompt, options);
    const proxy = resolveProxyEnv();

    const proc = spawn(command, args, {
      env: { ...process.env, ...proxy.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationReason: "abort" | "timeout" | null = null;
    let terminationPromise: Promise<void> | null = null;

    const finalizeReject = (error: GeminiCliError): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const finalizeResolve = (value: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectForTermination = (): void => {
      if (terminationReason === "abort") {
        finalizeReject(createCancelledError(options.signal?.reason));
        return;
      }

      finalizeReject(createTimeoutError(options.timeout, proxy.source));
    };

    const requestTermination = (reason: "abort" | "timeout"): void => {
      if (settled || terminationPromise) {
        return;
      }

      terminationReason = reason;
      terminationPromise = (async () => {
        const result = await terminateProcessTree(proc, { reason });
        log("warn", "Gemini CLI process termination completed", {
          reason,
          pid: result.pid,
          outcome: result.outcome,
          forceAttempted: result.forceAttempted,
          terminationError: result.error,
        });
      })()
        .catch((error) => {
          log("error", "Gemini CLI process termination failed", {
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          rejectForTermination();
        });
    };

    const abortHandler = (): void => {
      requestTermination("abort");
    };

    const timer = setTimeout(() => {
      requestTermination("timeout");
    }, options.timeout);

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortHandler);
    };

    options.signal?.addEventListener("abort", abortHandler, { once: true });

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (terminationPromise) {
        return;
      }

      if (options.signal?.aborted) {
        finalizeReject(createCancelledError(options.signal.reason));
        return;
      }

      if (code === 0) {
        finalizeResolve(stripMarkdownCodeBlock(stdout.trim()));
      } else {
        finalizeReject(createExitError(code, stdout.trim(), stderr.trim()));
      }
    });

    proc.on("error", (err) => {
      if (terminationPromise) {
        return;
      }
      finalizeReject(createSpawnError(err.message));
    });
  });
}

function stripMarkdownCodeBlock(raw: string): string {
  const match = raw.match(/^```[\w]*\n([\s\S]*?)\n```$/m);
  return match ? match[1].trim() : raw;
}