import { isTerminal } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { setTimeout as delay } from "node:timers/promises";
import { log } from "./gemini-runner.js";
import { createTaskFailureResult, normalizeError } from "./error-model.js";
import {
  formatTaskProgressStatus,
  getTaskExecutionDiagnostics,
  markTaskExecutionCancellationRequested,
  markTaskExecutionFailed,
  markTaskExecutionRunning,
  markTaskExecutionTerminal,
  type TaskProgressStage,
} from "./task-execution.js";
import {
  TASK_CANCELLATION_POLL_INTERVAL_MS,
  type OptionalTaskToolContext,
  type TaskStatusReader,
  type TaskToolExecutionStore,
  type TaskToolHandler,
} from "./task-tool-types.js";

interface TaskExecutionExtra {
  taskStore: TaskToolExecutionStore;
}

export async function isTaskExecutionActive(
  taskStore: TaskStatusReader,
  taskId: string,
): Promise<boolean> {
  try {
    const task = await taskStore.getTask(taskId);
    return Boolean(task && !isTerminal(task.status));
  } catch {
    return false;
  }
}

export function startTaskCancellationWatcher(
  taskStore: TaskStatusReader,
  taskId: string,
  controller: AbortController,
  pollIntervalMs: number = TASK_CANCELLATION_POLL_INTERVAL_MS,
): () => void {
  let stopped = false;

  void (async () => {
    while (!stopped && !controller.signal.aborted) {
      await delay(pollIntervalMs);
      if (stopped || controller.signal.aborted) {
        return;
      }

      try {
        const task = await taskStore.getTask(taskId);
        if (!task) {
          log(
            "warn",
            "Task disappeared while cancellation watcher was polling",
            {
              taskId,
              diagnostics: getTaskExecutionDiagnostics(),
            },
          );
          controller.abort(
            new Error(`Task ${taskId} disappeared while running.`),
          );
          return;
        }

        if (task.status === "cancelled") {
          markTaskExecutionCancellationRequested(taskId);
          log("info", "Task cancellation observed by watcher", {
            taskId,
            diagnostics: getTaskExecutionDiagnostics(),
          });
          controller.abort(new Error(`Task ${taskId} was cancelled.`));
          return;
        }

        if (isTerminal(task.status)) {
          return;
        }
      } catch (error) {
        controller.abort(
          error instanceof Error ? error : new Error(String(error)),
        );
        return;
      }
    }
  })();

  return () => {
    stopped = true;
  };
}

async function safelyReportStage(
  reportProgressStage: OptionalTaskToolContext["reportProgressStage"],
  stage: TaskProgressStage,
  detail?: string,
): Promise<void> {
  if (!reportProgressStage) {
    return;
  }

  try {
    await reportProgressStage(stage, detail);
  } catch (error) {
    log("warn", "Failed to update task stage", {
      stage,
      detail,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createTaskContext(
  taskId: string,
  extra: TaskExecutionExtra,
  controller: AbortController,
): OptionalTaskToolContext {
  return {
    taskId,
    signal: controller.signal,
    throwIfAborted: () => controller.signal.throwIfAborted(),
    reportProgressStage: async (stage, detail) => {
      controller.signal.throwIfAborted();
      await extra.taskStore.updateTaskStatus(
        taskId,
        "working",
        formatTaskProgressStatus(stage, detail),
      );
    },
  };
}

export async function executeTaskHandler<Args extends Record<string, unknown>>(
  name: string,
  taskId: string,
  args: Args,
  extra: TaskExecutionExtra,
  handler: TaskToolHandler<Args>,
  controller: AbortController,
  stopWatchingCancellation: () => void,
): Promise<void> {
  const taskContext = createTaskContext(taskId, extra, controller);

  if (!(await isTaskExecutionActive(extra.taskStore, taskId))) {
    stopWatchingCancellation();
    markTaskExecutionTerminal(taskId, "cancelled");
    log("info", "Skipping task execution because task is already terminal", {
      toolName: name,
      taskId,
      diagnostics: getTaskExecutionDiagnostics(),
    });
    return;
  }

  markTaskExecutionRunning(taskId);
  log("info", "Task execution started", {
    toolName: name,
    taskId,
    diagnostics: getTaskExecutionDiagnostics(),
  });

  try {
    const result = await handler(args, taskContext);

    if (!(await isTaskExecutionActive(extra.taskStore, taskId))) {
      markTaskExecutionTerminal(
        taskId,
        controller.signal.aborted ? "cancelled" : "failed",
      );
      log(
        "info",
        "Dropping task result because task became terminal before completion",
        {
          toolName: name,
          taskId,
          diagnostics: getTaskExecutionDiagnostics(),
        },
      );
      return;
    }

    await safelyReportStage(
      taskContext.reportProgressStage,
      "completed",
      "Task finished",
    );

    if (!(await isTaskExecutionActive(extra.taskStore, taskId))) {
      markTaskExecutionTerminal(
        taskId,
        controller.signal.aborted ? "cancelled" : "failed",
      );
      log(
        "info",
        "Skipping task result store because task became terminal during completion",
        {
          toolName: name,
          taskId,
          diagnostics: getTaskExecutionDiagnostics(),
        },
      );
      return;
    }

    await extra.taskStore.storeTaskResult(taskId, "completed", result);
    markTaskExecutionTerminal(taskId, "completed");
    log("info", "Task execution completed", {
      toolName: name,
      taskId,
      diagnostics: getTaskExecutionDiagnostics(),
    });
  } catch (error) {
    const normalizedError = normalizeError(error);
    const message = normalizedError.message;

    if (!(await isTaskExecutionActive(extra.taskStore, taskId))) {
      markTaskExecutionTerminal(
        taskId,
        controller.signal.aborted ? "cancelled" : "failed",
      );
      log(
        "info",
        "Skipping task failure handling because task is already terminal",
        {
          toolName: name,
          taskId,
          error: message,
          diagnostics: getTaskExecutionDiagnostics(),
        },
      );
      return;
    }

    await safelyReportStage(taskContext.reportProgressStage, "failed", message);

    if (!(await isTaskExecutionActive(extra.taskStore, taskId))) {
      markTaskExecutionTerminal(
        taskId,
        controller.signal.aborted ? "cancelled" : "failed",
      );
      log(
        "info",
        "Skipping task failure result store because task became terminal",
        {
          toolName: name,
          taskId,
          error: message,
          diagnostics: getTaskExecutionDiagnostics(),
        },
      );
      return;
    }

    markTaskExecutionFailed(taskId, normalizedError);
    log("error", "Gemini MCP task failed", {
      toolName: name,
      taskId,
      error: message,
      errorKind: normalizedError.kind,
      retryable: normalizedError.retryable,
      diagnostics: getTaskExecutionDiagnostics(),
    });
    await extra.taskStore.storeTaskResult(
      taskId,
      "failed",
      createTaskFailureResult(normalizedError),
    );
  } finally {
    stopWatchingCancellation();
  }
}
