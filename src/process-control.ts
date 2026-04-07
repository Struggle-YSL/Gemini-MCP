import { spawn, type ChildProcess } from "node:child_process";
import { RUNTIME_CONFIG } from "./config.js";

export type ProcessTerminationReason = "abort" | "timeout";
export type ProcessTerminationOutcome =
  | "graceful"
  | "forced"
  | "already-exited"
  | "failed-to-terminate";

export interface ProcessTerminationResult {
  outcome: ProcessTerminationOutcome;
  reason: ProcessTerminationReason;
  pid: number | null;
  platform: NodeJS.Platform;
  requestedAt: number;
  completedAt: number;
  gracePeriodMs: number;
  forceWaitMs: number;
  forceAttempted: boolean;
  error?: string;
}

export interface ProcessTerminationDiagnostics {
  totalRequests: number;
  gracefulTerminations: number;
  forcedTerminations: number;
  alreadyExited: number;
  failedTerminations: number;
  lastResult: ProcessTerminationResult | null;
}

export interface ProcessControlDependencies {
  now?: () => number;
  platform?: NodeJS.Platform;
  spawnForceKillTree?: (
    pid: number,
    platform: NodeJS.Platform,
  ) => Promise<void>;
}

export interface TerminateProcessTreeOptions {
  reason: ProcessTerminationReason;
  gracePeriodMs?: number;
  forceWaitMs?: number;
  dependencies?: ProcessControlDependencies;
}

const DEFAULT_TERMINATION_GRACE_MS = RUNTIME_CONFIG.processTerminationGraceMs;
const DEFAULT_FORCE_WAIT_MS = RUNTIME_CONFIG.processTerminationForceWaitMs;
const COMMAND_TIMEOUT_MS = 2000;

const terminationDiagnostics: ProcessTerminationDiagnostics = {
  totalRequests: 0,
  gracefulTerminations: 0,
  forcedTerminations: 0,
  alreadyExited: 0,
  failedTerminations: 0,
  lastResult: null,
};

function isProcessExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function cloneResult(
  result: ProcessTerminationResult | null,
): ProcessTerminationResult | null {
  return result ? { ...result } : null;
}

function recordProcessTermination(
  result: ProcessTerminationResult,
): ProcessTerminationResult {
  terminationDiagnostics.totalRequests += 1;
  switch (result.outcome) {
    case "graceful":
      terminationDiagnostics.gracefulTerminations += 1;
      break;
    case "forced":
      terminationDiagnostics.forcedTerminations += 1;
      break;
    case "already-exited":
      terminationDiagnostics.alreadyExited += 1;
      break;
    case "failed-to-terminate":
      terminationDiagnostics.failedTerminations += 1;
      break;
  }
  terminationDiagnostics.lastResult = { ...result };
  return result;
}

function createTerminationResult(
  outcome: ProcessTerminationOutcome,
  reason: ProcessTerminationReason,
  platform: NodeJS.Platform,
  pid: number | null,
  requestedAt: number,
  gracePeriodMs: number,
  forceWaitMs: number,
  forceAttempted: boolean,
  completedAt: number,
  error?: string,
): ProcessTerminationResult {
  return {
    outcome,
    reason,
    platform,
    pid,
    requestedAt,
    completedAt,
    gracePeriodMs,
    forceWaitMs,
    forceAttempted,
    error,
  };
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (isProcessExited(proc)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(isProcessExited(proc));
    }, timeoutMs);

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(true);
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      proc.removeListener("exit", finish);
      proc.removeListener("close", finish);
    };

    proc.once("exit", finish);
    proc.once("close", finish);
  });
}

function tryKill(
  proc: ChildProcess,
  signal?: NodeJS.Signals,
): string | undefined {
  try {
    const ok = signal ? proc.kill(signal) : proc.kill();
    if (!ok && !isProcessExited(proc)) {
      return signal
        ? `proc.kill(${signal}) returned false`
        : "proc.kill() returned false";
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function spawnCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: platform === "win32",
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function defaultForceKillTree(
  pid: number,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === "win32") {
    await spawnCommand("taskkill", ["/pid", String(pid), "/T", "/F"], platform);
    return;
  }

  await spawnCommand("pkill", ["-KILL", "-P", String(pid)], platform).catch(
    () => {
      return undefined;
    },
  );
}

export function getProcessTerminationDiagnostics(): ProcessTerminationDiagnostics {
  return {
    totalRequests: terminationDiagnostics.totalRequests,
    gracefulTerminations: terminationDiagnostics.gracefulTerminations,
    forcedTerminations: terminationDiagnostics.forcedTerminations,
    alreadyExited: terminationDiagnostics.alreadyExited,
    failedTerminations: terminationDiagnostics.failedTerminations,
    lastResult: cloneResult(terminationDiagnostics.lastResult),
  };
}

export function resetProcessTerminationDiagnostics(): void {
  terminationDiagnostics.totalRequests = 0;
  terminationDiagnostics.gracefulTerminations = 0;
  terminationDiagnostics.forcedTerminations = 0;
  terminationDiagnostics.alreadyExited = 0;
  terminationDiagnostics.failedTerminations = 0;
  terminationDiagnostics.lastResult = null;
}

export async function terminateProcessTree(
  proc: ChildProcess,
  options: TerminateProcessTreeOptions,
): Promise<ProcessTerminationResult> {
  const dependencies = options.dependencies ?? {};
  const platform = dependencies.platform ?? process.platform;
  const now = dependencies.now ?? Date.now;
  const requestedAt = now();
  const pid = typeof proc.pid === "number" ? proc.pid : null;
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const forceWaitMs = options.forceWaitMs ?? DEFAULT_FORCE_WAIT_MS;

  if (isProcessExited(proc)) {
    return recordProcessTermination(
      createTerminationResult(
        "already-exited",
        options.reason,
        platform,
        pid,
        requestedAt,
        gracePeriodMs,
        forceWaitMs,
        false,
        now(),
      ),
    );
  }

  const gracefulError =
    platform === "win32" ? tryKill(proc) : tryKill(proc, "SIGTERM");

  const exitedGracefully = await waitForExit(proc, gracePeriodMs);
  if (exitedGracefully) {
    return recordProcessTermination(
      createTerminationResult(
        "graceful",
        options.reason,
        platform,
        pid,
        requestedAt,
        gracePeriodMs,
        forceWaitMs,
        false,
        now(),
        gracefulError,
      ),
    );
  }

  const errors = gracefulError ? [gracefulError] : [];

  if (platform === "win32") {
    if (pid === null) {
      errors.push("Cannot force terminate process tree without a process id.");
    } else {
      try {
        const forceKill =
          dependencies.spawnForceKillTree ?? defaultForceKillTree;
        await forceKill(pid, platform);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } else {
    const forceError = tryKill(proc, "SIGKILL");
    if (forceError) {
      errors.push(forceError);
    }
    if (pid !== null) {
      try {
        const forceKill =
          dependencies.spawnForceKillTree ?? defaultForceKillTree;
        await forceKill(pid, platform);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const exitedForced = await waitForExit(proc, forceWaitMs);
  if (exitedForced) {
    return recordProcessTermination(
      createTerminationResult(
        "forced",
        options.reason,
        platform,
        pid,
        requestedAt,
        gracePeriodMs,
        forceWaitMs,
        true,
        now(),
        errors.length > 0 ? errors.join("; ") : undefined,
      ),
    );
  }

  return recordProcessTermination(
    createTerminationResult(
      "failed-to-terminate",
      options.reason,
      platform,
      pid,
      requestedAt,
      gracePeriodMs,
      forceWaitMs,
      true,
      now(),
      errors.length > 0 ? errors.join("; ") : undefined,
    ),
  );
}
