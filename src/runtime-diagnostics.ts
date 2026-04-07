import { z } from "zod";
import { ORCHESTRATOR_SCHEMA_VERSION } from "./orchestrator-contracts.js";
import { GEMINI, getRuntimeDiagnostics as getGeminiRuntimeDiagnostics } from "./gemini-runner.js";
import type { OrchestratorRuntimeManager } from "./orchestrator-runtime-manager.js";
import { getProcessTerminationDiagnostics } from "./process-control.js";
import type { SQLitePersistenceRuntime } from "./sqlite-persistence.js";
import {
  getTaskExecutionDiagnostics,
  getTaskExecutionFailureDiagnostics,
  getTaskExecutionSchedulerDiagnostics,
  listTaskExecutionRecords,
} from "./task-execution.js";

const taskExecutionStateSchema = z.enum([
  "queued",
  "running",
  "cancel_requested",
  "completed",
  "failed",
  "cancelled",
]);

const orchestratorRuntimeStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_codex",
  "idle",
  "completed",
  "failed",
  "invalid-graph",
  "failed-recovery",
  "manual-review-required",
]);

const processTerminationOutcomeSchema = z.enum([
  "graceful",
  "forced",
  "already-exited",
  "failed-to-terminate",
]);

const processTerminationReasonSchema = z.enum(["abort", "timeout"]);

export const getRuntimeDiagnosticsInputSchema = z.object({});

export const runtimeGeminiDiagnosticsSchema = z.object({
  exec_path: z.string().nullable(),
  global_bin_dir: z.string(),
  proxy_source: z.enum(["env", "windows-registry", "none"]),
  active_sessions: z.number().int().min(0),
});

export const taskExecutionDiagnosticsSchema = z.object({
  total_known_tasks: z.number().int().min(0),
  queued_tasks: z.number().int().min(0),
  running_tasks: z.number().int().min(0),
  cancel_requested_tasks: z.number().int().min(0),
  terminal_tasks: z.number().int().min(0),
});

export const taskExecutionFailureDiagnosticsSchema = z.object({
  total_failed_tasks: z.number().int().min(0),
  structured_failure_tasks: z.number().int().min(0),
  retryable_failures: z.number().int().min(0),
  non_retryable_failures: z.number().int().min(0),
  failure_kinds: z.record(z.string(), z.number().int().min(0)),
});

export const taskExecutionRecordSchema = z.object({
  task_id: z.string(),
  tool_name: z.string(),
  queue_key: z.string(),
  state: taskExecutionStateSchema,
  queued_at: z.number().int().min(0),
  started_at: z.number().int().min(0).optional(),
  finished_at: z.number().int().min(0).optional(),
  cancellation_requested_at: z.number().int().min(0).optional(),
  last_error_kind: z.string().optional(),
  last_error_retryable: z.boolean().optional(),
  last_error_message: z.string().optional(),
});

export const taskExecutionSchedulerSchema = z.object({
  queue_key: z.string(),
  active_count: z.number().int().min(0),
  pending_count: z.number().int().min(0),
  concurrency_limit: z.number().int().min(1),
});

export const managedOrchestratorRunDiagnosticSchema = z.object({
  orchestrator_id: z.string(),
  status: orchestratorRuntimeStatusSchema,
  active: z.boolean(),
  updated_at: z.string(),
});

export const orchestratorRuntimeManagerDiagnosticsSchema = z.object({
  started: z.boolean(),
  tick_ms: z.number().int().min(1),
  max_active_runs: z.number().int().min(1),
  max_gemini_retries: z.number().int().min(0),
  queued_runs: z.number().int().min(0),
  running_runs: z.number().int().min(0),
  tracked_runs: z.array(managedOrchestratorRunDiagnosticSchema),
  recovered_runs: z.number().int().min(0),
});

export const processTerminationResultSchema = z.object({
  outcome: processTerminationOutcomeSchema,
  reason: processTerminationReasonSchema,
  pid: z.number().int().nullable(),
  platform: z.string(),
  requested_at: z.number().int().min(0),
  completed_at: z.number().int().min(0),
  grace_period_ms: z.number().int().min(1),
  force_wait_ms: z.number().int().min(1),
  force_attempted: z.boolean(),
  error: z.string().optional(),
});

export const processTerminationDiagnosticsSchema = z.object({
  total_requests: z.number().int().min(0),
  graceful_terminations: z.number().int().min(0),
  forced_terminations: z.number().int().min(0),
  already_exited: z.number().int().min(0),
  failed_terminations: z.number().int().min(0),
  last_result: processTerminationResultSchema.nullable(),
});

export const persistenceDiagnosticsSchema = z.object({
  mode: z.enum(["sqlite", "memory"]),
  db_path: z.string().optional(),
  task_store_persistent: z.boolean(),
  session_store_persistent: z.boolean(),
  orchestrator_store_persistent: z.boolean(),
  recovery: z.object({
    interrupted_tasks_recovered: z.number().int().min(0),
    cleared_queued_messages: z.number().int().min(0),
  }),
});

export const getRuntimeDiagnosticsOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  generated_at: z.string(),
  gemini_runtime: runtimeGeminiDiagnosticsSchema,
  process_control: processTerminationDiagnosticsSchema,
  task_execution: z.object({
    diagnostics: taskExecutionDiagnosticsSchema,
    failure_diagnostics: taskExecutionFailureDiagnosticsSchema,
    records: z.array(taskExecutionRecordSchema),
    schedulers: z.array(taskExecutionSchedulerSchema),
  }),
  orchestrator_runtime: z.object({
    enabled: z.boolean(),
    diagnostics: orchestratorRuntimeManagerDiagnosticsSchema.nullable(),
  }),
  persistence: persistenceDiagnosticsSchema,
});

export type GetRuntimeDiagnosticsInput = z.infer<typeof getRuntimeDiagnosticsInputSchema>;
export type GetRuntimeDiagnosticsOutput = z.infer<typeof getRuntimeDiagnosticsOutputSchema>;

export interface RuntimeDiagnosticsOptions {
  sqlitePersistence?: SQLitePersistenceRuntime;
  orchestratorRuntimeManager?: Pick<OrchestratorRuntimeManager, "getDiagnostics">;
}

export function getRuntimeDiagnosticsSnapshot(
  rawInput: unknown,
  options: RuntimeDiagnosticsOptions = {},
): GetRuntimeDiagnosticsOutput {
  getRuntimeDiagnosticsInputSchema.parse(rawInput ?? {});

  const generatedAt = new Date().toISOString();
  const geminiDiagnostics = getGeminiRuntimeDiagnostics();
  const processDiagnostics = getProcessTerminationDiagnostics();
  const taskDiagnostics = getTaskExecutionDiagnostics();
  const taskFailureDiagnostics = getTaskExecutionFailureDiagnostics();
  const taskRecords = listTaskExecutionRecords();
  const schedulerDiagnostics = getTaskExecutionSchedulerDiagnostics();
  const orchestratorDiagnostics = options.orchestratorRuntimeManager?.getDiagnostics() ?? null;
  const sqlitePersistence = options.sqlitePersistence;

  return getRuntimeDiagnosticsOutputSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    generated_at: generatedAt,
    gemini_runtime: {
      exec_path: GEMINI.execPath,
      global_bin_dir: GEMINI.globalBinDir,
      proxy_source: geminiDiagnostics.proxySource,
      active_sessions: geminiDiagnostics.activeSessions,
    },
    process_control: {
      total_requests: processDiagnostics.totalRequests,
      graceful_terminations: processDiagnostics.gracefulTerminations,
      forced_terminations: processDiagnostics.forcedTerminations,
      already_exited: processDiagnostics.alreadyExited,
      failed_terminations: processDiagnostics.failedTerminations,
      last_result: processDiagnostics.lastResult
        ? {
            outcome: processDiagnostics.lastResult.outcome,
            reason: processDiagnostics.lastResult.reason,
            pid: processDiagnostics.lastResult.pid,
            platform: processDiagnostics.lastResult.platform,
            requested_at: processDiagnostics.lastResult.requestedAt,
            completed_at: processDiagnostics.lastResult.completedAt,
            grace_period_ms: processDiagnostics.lastResult.gracePeriodMs,
            force_wait_ms: processDiagnostics.lastResult.forceWaitMs,
            force_attempted: processDiagnostics.lastResult.forceAttempted,
            error: processDiagnostics.lastResult.error,
          }
        : null,
    },
    task_execution: {
      diagnostics: {
        total_known_tasks: taskDiagnostics.totalKnownTasks,
        queued_tasks: taskDiagnostics.queuedTasks,
        running_tasks: taskDiagnostics.runningTasks,
        cancel_requested_tasks: taskDiagnostics.cancelRequestedTasks,
        terminal_tasks: taskDiagnostics.terminalTasks,
      },
      failure_diagnostics: {
        total_failed_tasks: taskFailureDiagnostics.totalFailedTasks,
        structured_failure_tasks: taskFailureDiagnostics.structuredFailureTasks,
        retryable_failures: taskFailureDiagnostics.retryableFailures,
        non_retryable_failures: taskFailureDiagnostics.nonRetryableFailures,
        failure_kinds: taskFailureDiagnostics.failureKinds,
      },
      records: taskRecords.map((record) => ({
        task_id: record.taskId,
        tool_name: record.toolName,
        queue_key: record.queueKey,
        state: record.state,
        queued_at: record.queuedAt,
        started_at: record.startedAt,
        finished_at: record.finishedAt,
        cancellation_requested_at: record.cancellationRequestedAt,
        last_error_kind: record.lastErrorKind,
        last_error_retryable: record.lastErrorRetryable,
        last_error_message: record.lastErrorMessage,
      })),
      schedulers: schedulerDiagnostics.map((scheduler) => ({
        queue_key: scheduler.queueKey,
        active_count: scheduler.activeCount,
        pending_count: scheduler.pendingCount,
        concurrency_limit: scheduler.concurrencyLimit,
      })),
    },
    orchestrator_runtime: {
      enabled: Boolean(options.orchestratorRuntimeManager),
      diagnostics: orchestratorDiagnostics,
    },
    persistence: {
      mode: sqlitePersistence ? "sqlite" : "memory",
      db_path: sqlitePersistence?.dbPath,
      task_store_persistent: Boolean(sqlitePersistence),
      session_store_persistent: Boolean(sqlitePersistence),
      orchestrator_store_persistent: Boolean(sqlitePersistence?.orchestratorStore),
      recovery: {
        interrupted_tasks_recovered: sqlitePersistence?.recovery.interruptedTasksRecovered ?? 0,
        cleared_queued_messages: sqlitePersistence?.recovery.clearedQueuedMessages ?? 0,
      },
    },
  });
}
