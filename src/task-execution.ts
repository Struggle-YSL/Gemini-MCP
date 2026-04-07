import type { StructuredError } from "./error-model.js";

export type TaskProgressStage =
  | "queued"
  | "prompting"
  | "generating"
  | "packaging"
  | "completed"
  | "failed";

export type TaskExecutionState =
  | "queued"
  | "running"
  | "cancel_requested"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskExecutionRecord {
  taskId: string;
  toolName: string;
  queueKey: string;
  state: TaskExecutionState;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancellationRequestedAt?: number;
  lastErrorKind?: string;
  lastErrorRetryable?: boolean;
  lastErrorMessage?: string;
}

export interface TaskExecutionDiagnostics {
  totalKnownTasks: number;
  queuedTasks: number;
  runningTasks: number;
  cancelRequestedTasks: number;
  terminalTasks: number;
}

export interface TaskExecutionFailureDiagnostics {
  totalFailedTasks: number;
  structuredFailureTasks: number;
  retryableFailures: number;
  nonRetryableFailures: number;
  failureKinds: Record<string, number>;
}

export interface TaskExecutionSchedulerDiagnostic {
  queueKey: string;
  activeCount: number;
  pendingCount: number;
  concurrencyLimit: number;
}

function normalizeConcurrencyLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) {
    return 1;
  }

  return Math.floor(limit);
}

export function formatTaskProgressStatus(
  stage: TaskProgressStage,
  detail?: string,
): string {
  return detail ? `${stage}: ${detail}` : stage;
}

export class TaskExecutionScheduler {
  private activeCount = 0;
  private readonly pending: Array<() => Promise<void>> = [];
  private concurrencyLimit: number;

  constructor(concurrencyLimit: number) {
    this.concurrencyLimit = normalizeConcurrencyLimit(concurrencyLimit);
  }

  enqueue(operation: () => Promise<void>): void {
    this.pending.push(operation);
    this.drain();
  }

  setConcurrencyLimit(limit: number): void {
    this.concurrencyLimit = normalizeConcurrencyLimit(limit);
    this.drain();
  }

  getStats(): {
    activeCount: number;
    pendingCount: number;
    concurrencyLimit: number;
  } {
    return {
      activeCount: this.activeCount,
      pendingCount: this.pending.length,
      concurrencyLimit: this.concurrencyLimit,
    };
  }

  private drain(): void {
    while (
      this.activeCount < this.concurrencyLimit &&
      this.pending.length > 0
    ) {
      const operation = this.pending.shift();
      if (!operation) {
        return;
      }

      this.activeCount += 1;
      void (async () => {
        try {
          await operation();
        } finally {
          this.activeCount -= 1;
          this.drain();
        }
      })();
    }
  }
}

const sharedSchedulers = new Map<string, TaskExecutionScheduler>();
const executionRecords = new Map<string, TaskExecutionRecord>();

export function registerTaskExecution(
  taskId: string,
  toolName: string,
  queueKey: string,
  initialState: TaskExecutionState,
): void {
  const now = Date.now();
  executionRecords.set(taskId, {
    taskId,
    toolName,
    queueKey,
    state: initialState,
    queuedAt: now,
    startedAt: initialState === "running" ? now : undefined,
  });
}

export function markTaskExecutionRunning(taskId: string): void {
  const record = executionRecords.get(taskId);
  if (!record) {
    return;
  }

  record.state = "running";
  record.startedAt ??= Date.now();
}

export function markTaskExecutionCancellationRequested(taskId: string): void {
  const record = executionRecords.get(taskId);
  if (!record) {
    return;
  }

  if (
    record.state === "completed" ||
    record.state === "failed" ||
    record.state === "cancelled"
  ) {
    return;
  }

  record.state = "cancel_requested";
  record.cancellationRequestedAt ??= Date.now();
}

export function markTaskExecutionFailed(
  taskId: string,
  error: StructuredError,
): void {
  const record = executionRecords.get(taskId);
  if (!record) {
    return;
  }

  record.state = "failed";
  record.finishedAt = Date.now();
  record.lastErrorKind = error.kind;
  record.lastErrorRetryable = error.retryable;
  record.lastErrorMessage = error.message;
}

export function markTaskExecutionTerminal(
  taskId: string,
  state: Extract<TaskExecutionState, "completed" | "failed" | "cancelled">,
): void {
  const record = executionRecords.get(taskId);
  if (!record) {
    return;
  }

  record.state = state;
  record.finishedAt = Date.now();

  if (state !== "failed") {
    record.lastErrorKind = undefined;
    record.lastErrorRetryable = undefined;
    record.lastErrorMessage = undefined;
  }
}

export function getTaskExecutionDiagnostics(): TaskExecutionDiagnostics {
  let queuedTasks = 0;
  let runningTasks = 0;
  let cancelRequestedTasks = 0;
  let terminalTasks = 0;

  for (const record of executionRecords.values()) {
    switch (record.state) {
      case "queued":
        queuedTasks += 1;
        break;
      case "running":
        runningTasks += 1;
        break;
      case "cancel_requested":
        cancelRequestedTasks += 1;
        break;
      default:
        terminalTasks += 1;
        break;
    }
  }

  return {
    totalKnownTasks: executionRecords.size,
    queuedTasks,
    runningTasks,
    cancelRequestedTasks,
    terminalTasks,
  };
}

export function getTaskExecutionFailureDiagnostics(): TaskExecutionFailureDiagnostics {
  let totalFailedTasks = 0;
  let structuredFailureTasks = 0;
  let retryableFailures = 0;
  let nonRetryableFailures = 0;
  const failureKinds: Record<string, number> = {};

  for (const record of executionRecords.values()) {
    if (record.state !== "failed") {
      continue;
    }

    totalFailedTasks += 1;
    const kind = record.lastErrorKind ?? "unknown";
    failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;

    if (record.lastErrorKind) {
      structuredFailureTasks += 1;
    }

    if (record.lastErrorRetryable === true) {
      retryableFailures += 1;
    } else {
      nonRetryableFailures += 1;
    }
  }

  return {
    totalFailedTasks,
    structuredFailureTasks,
    retryableFailures,
    nonRetryableFailures,
    failureKinds,
  };
}

export function listTaskExecutionRecords(): TaskExecutionRecord[] {
  return [...executionRecords.values()]
    .map((record) => ({ ...record }))
    .sort((left, right) => left.queuedAt - right.queuedAt);
}

export function getTaskExecutionSchedulerDiagnostics(): TaskExecutionSchedulerDiagnostic[] {
  return [...sharedSchedulers.entries()]
    .map(([queueKey, scheduler]) => ({
      queueKey,
      ...scheduler.getStats(),
    }))
    .sort((left, right) => left.queueKey.localeCompare(right.queueKey));
}

export function getSharedTaskExecutionScheduler(
  key: string,
  concurrencyLimit: number,
): TaskExecutionScheduler {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    throw new Error("Task execution scheduler key must not be empty.");
  }

  const existing = sharedSchedulers.get(normalizedKey);
  if (existing) {
    existing.setConcurrencyLimit(concurrencyLimit);
    return existing;
  }

  const scheduler = new TaskExecutionScheduler(concurrencyLimit);
  sharedSchedulers.set(normalizedKey, scheduler);
  return scheduler;
}
