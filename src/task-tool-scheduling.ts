import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { log } from "./gemini-runner.js";
import {
  formatTaskProgressStatus,
  getSharedTaskExecutionScheduler,
  getTaskExecutionDiagnostics,
  registerTaskExecution,
} from "./task-execution.js";
import type { TaskToolExecutionOptions } from "./task-tool-types.js";

interface TaskExecutionStatusStore {
  updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
  ): Promise<void>;
}

interface ResolvedTaskExecutionOptions {
  mode: "immediate" | "queued";
  queueKey: string;
  concurrencyLimit: number;
}

interface ScheduleTaskExecutionParams {
  toolName: string;
  taskId: string;
  execution?: TaskToolExecutionOptions;
  taskStore: TaskExecutionStatusStore;
  run: () => Promise<void>;
  queuedLogMessage: string;
  immediateLogMessage: string;
}

export function resolveTaskExecutionOptions(
  toolName: string,
  execution?: TaskToolExecutionOptions,
): ResolvedTaskExecutionOptions {
  const mode = execution?.mode ?? "immediate";
  const requestedQueueKey = execution?.queueKey?.trim();
  const queueKey =
    requestedQueueKey && requestedQueueKey.length > 0
      ? requestedQueueKey
      : toolName;
  const concurrencyLimit = execution?.concurrencyLimit ?? 1;

  return {
    mode,
    queueKey,
    concurrencyLimit,
  };
}

export async function scheduleTaskExecution(
  params: ScheduleTaskExecutionParams,
): Promise<void> {
  const {
    toolName,
    taskId,
    execution,
    taskStore,
    run,
    queuedLogMessage,
    immediateLogMessage,
  } = params;

  const resolvedOptions = resolveTaskExecutionOptions(toolName, execution);
  registerTaskExecution(
    taskId,
    toolName,
    resolvedOptions.queueKey,
    resolvedOptions.mode === "queued" ? "queued" : "running",
  );

  if (resolvedOptions.mode === "queued") {
    await taskStore.updateTaskStatus(
      taskId,
      "working",
      formatTaskProgressStatus("queued", "Waiting for execution slot"),
    );
    log("info", queuedLogMessage, {
      toolName,
      taskId,
      queueKey: resolvedOptions.queueKey,
      diagnostics: getTaskExecutionDiagnostics(),
    });
    getSharedTaskExecutionScheduler(
      resolvedOptions.queueKey,
      resolvedOptions.concurrencyLimit,
    ).enqueue(run);
    return;
  }

  log("info", immediateLogMessage, {
    toolName,
    taskId,
    diagnostics: getTaskExecutionDiagnostics(),
  });
  void run();
}
