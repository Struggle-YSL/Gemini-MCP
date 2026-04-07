import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { createSQLitePersistenceRuntime } from "../dist/sqlite-persistence.js";
import { OrchestratorRuntimeManager } from "../dist/orchestrator-runtime-manager.js";
import { createWorkItem } from "../dist/orchestrator-state.js";
import { getRuntimeDiagnosticsSnapshot } from "../dist/runtime-diagnostics.js";
import {
  resetProcessTerminationDiagnostics,
  terminateProcessTree,
} from "../dist/process-control.js";
import {
  getSharedTaskExecutionScheduler,
  markTaskExecutionCancellationRequested,
  markTaskExecutionFailed,
  markTaskExecutionRunning,
  registerTaskExecution,
} from "../dist/task-execution.js";

const projectContext = {
  design_system: "internal admin ui",
  existing_components: "Card, Drawer, Badge",
  conventions: "React + TypeScript",
};

class FakeChildProcess extends EventEmitter {
  constructor(pid = 8765) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
  }

  kill() {
    this.killed = true;
    setTimeout(() => this.finish(0, "SIGTERM"), 5);
    return true;
  }

  finish(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

function createRuntime() {
  const tempRoot = mkdtempSync(
    path.join(tmpdir(), "gemini-mcp-runtime-diagnostics-"),
  );
  const dbPath = path.join(tempRoot, "state.sqlite");
  const runtime = createSQLitePersistenceRuntime(dbPath);
  assert.ok(runtime, "expected SQLite persistence runtime to be available");
  return runtime;
}

test("getRuntimeDiagnosticsSnapshot returns aggregated runtime state and detailed records", async () => {
  resetProcessTerminationDiagnostics();
  await terminateProcessTree(new FakeChildProcess(), {
    reason: "abort",
    gracePeriodMs: 20,
    forceWaitMs: 10,
    dependencies: {
      platform: "win32",
    },
  });

  const runtime = createRuntime();
  const orchestratorId = `diag-orchestrator-${Date.now()}`;
  const queueKey = `diag-queue-${Date.now()}`;
  const queuedTaskId = `diag-task-queued-${Date.now()}`;
  const cancelTaskId = `diag-task-cancel-${Date.now()}`;
  const failedTaskId = `diag-task-failed-${Date.now()}`;

  registerTaskExecution(
    queuedTaskId,
    "implement_frontend_task",
    queueKey,
    "queued",
  );
  registerTaskExecution(
    cancelTaskId,
    "plan_frontend_solution",
    queueKey,
    "queued",
  );
  registerTaskExecution(
    failedTaskId,
    "plan_frontend_solution",
    queueKey,
    "running",
  );

  markTaskExecutionRunning(cancelTaskId);
  markTaskExecutionCancellationRequested(cancelTaskId);
  markTaskExecutionFailed(failedTaskId, {
    kind: "network",
    message: "socket hang up",
    retryable: true,
  });
  getSharedTaskExecutionScheduler(queueKey, 2);

  const workItems = [
    createWorkItem({
      id: "frontend-plan-1",
      type: "frontend-plan",
      owner: "gemini",
      scope: "Plan compare drawer",
    }),
  ];

  runtime.orchestratorStore.saveOrchestratorSnapshot({
    orchestratorId,
    graph: {
      schema_version: "1.0",
      work_items: workItems,
    },
    state: {
      schema_version: "1.0",
      work_items: workItems,
      task_bindings: [],
      frontend_threads: [],
      work_item_results: [],
    },
    summary: {
      status: "ok",
      message: "queued",
      ready_work_item_ids: ["frontend-plan-1"],
      waiting_work_item_ids: [],
      completed_work_item_ids: [],
      failed_work_item_ids: [],
    },
    context: {
      project_context: projectContext,
    },
  });

  const manager = new OrchestratorRuntimeManager({
    orchestratorStore: runtime.orchestratorStore,
    tickMs: 15,
    maxActiveRuns: 1,
    runner: {
      run: async (input) => {
        runtime.orchestratorStore.saveOrchestratorSnapshot({
          orchestratorId: input.orchestrator_id,
          graph: input.graph,
          state: {
            ...input.state,
            work_items: input.state.work_items.map((item) => ({
              ...item,
              status: "completed",
            })),
          },
          summary: {
            status: "ok",
            message: "completed",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: input.state.work_items.map(
              (item) => item.id,
            ),
            failed_work_item_ids: [],
          },
          context: {
            project_context: input.project_context,
            backend_contracts: input.backend_contracts,
            acceptance_criteria: input.acceptance_criteria,
            work_item_inputs: input.work_item_inputs,
          },
          runtime: {
            status: "completed",
            active: false,
            updated_at: new Date().toISOString(),
            last_tick_at: new Date().toISOString(),
          },
        });
        return {
          schema_version: "1.0",
          orchestrator_id: input.orchestrator_id,
          persisted: true,
          loaded_from_store: false,
          updated_at: new Date().toISOString(),
          state: {
            ...input.state,
            work_items: input.state.work_items.map((item) => ({
              ...item,
              status: "completed",
            })),
          },
          submitted_tasks: [],
          codex_actions: [],
          blocked_work_items: [],
          graph_validation_issues: [],
          summary: {
            status: "ok",
            message: "completed",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: input.state.work_items.map(
              (item) => item.id,
            ),
            failed_work_item_ids: [],
          },
        };
      },
    },
  });

  manager.start();
  await delay(80);
  const diagnostics = getRuntimeDiagnosticsSnapshot(
    {},
    {
      sqlitePersistence: runtime,
      orchestratorRuntimeManager: manager,
    },
  );
  manager.stop();

  assert.equal(diagnostics.persistence.mode, "sqlite");
  assert.equal(diagnostics.orchestrator_runtime.enabled, true);
  assert.ok(diagnostics.orchestrator_runtime.diagnostics);
  assert.ok(
    diagnostics.orchestrator_runtime.diagnostics.tracked_runs.some(
      (run) => run.orchestrator_id === orchestratorId,
    ),
  );
  assert.ok(
    diagnostics.task_execution.records.some(
      (record) => record.task_id === queuedTaskId,
    ),
  );
  assert.ok(
    diagnostics.task_execution.records.some(
      (record) =>
        record.task_id === cancelTaskId && record.state === "cancel_requested",
    ),
  );
  assert.ok(
    diagnostics.task_execution.records.some(
      (record) =>
        record.task_id === failedTaskId && record.last_error_kind === "network",
    ),
  );
  assert.ok(
    diagnostics.task_execution.schedulers.some(
      (scheduler) => scheduler.queue_key === queueKey,
    ),
  );
  assert.equal(
    diagnostics.task_execution.failure_diagnostics.total_failed_tasks >= 1,
    true,
  );
  assert.equal(
    diagnostics.task_execution.failure_diagnostics.structured_failure_tasks >=
      1,
    true,
  );
  assert.equal(
    diagnostics.task_execution.failure_diagnostics.retryable_failures >= 1,
    true,
  );
  assert.equal(
    (diagnostics.task_execution.failure_diagnostics.failure_kinds.network ??
      0) >= 1,
    true,
  );
  assert.equal(typeof diagnostics.gemini_runtime.active_sessions, "number");
  assert.equal(diagnostics.process_control.total_requests >= 1, true);
  assert.equal(diagnostics.process_control.last_result?.reason, "abort");
});
