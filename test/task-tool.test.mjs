import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  getTaskExecutionDiagnostics,
  markTaskExecutionCancellationRequested,
  markTaskExecutionRunning,
  markTaskExecutionTerminal,
  registerTaskExecution,
} from "../dist/task-execution.js";
import {
  isTaskExecutionActive,
  startTaskCancellationWatcher,
} from "../dist/task-tool.js";

test("isTaskExecutionActive returns true for non-terminal tasks", async () => {
  const active = await isTaskExecutionActive(
    {
      async getTask() {
        return { status: "working" };
      },
    },
    "task-1",
  );

  assert.equal(active, true);
});

test("isTaskExecutionActive returns false for cancelled or missing tasks", async () => {
  const cancelled = await isTaskExecutionActive(
    {
      async getTask() {
        return { status: "cancelled" };
      },
    },
    "task-2",
  );
  const missing = await isTaskExecutionActive(
    {
      async getTask() {
        return null;
      },
    },
    "task-3",
  );

  assert.equal(cancelled, false);
  assert.equal(missing, false);
});

test("startTaskCancellationWatcher aborts controller when task becomes cancelled", async () => {
  let status = "working";
  const controller = new AbortController();
  const stopWatching = startTaskCancellationWatcher(
    {
      async getTask() {
        return { status };
      },
    },
    "task-4",
    controller,
    10,
  );

  await delay(25);
  status = "cancelled";
  await delay(30);

  stopWatching();
  assert.equal(controller.signal.aborted, true);
  assert.match(String(controller.signal.reason), /cancelled/i);
});

test("task execution diagnostics track queued running cancel-requested and terminal tasks", () => {
  registerTaskExecution("diag-queued", "implement_frontend_task", "frontend-implementation", "queued");
  registerTaskExecution("diag-running", "implement_frontend_task", "frontend-implementation", "running");
  registerTaskExecution("diag-cancel", "implement_frontend_task", "frontend-implementation", "queued");
  registerTaskExecution("diag-terminal", "implement_frontend_task", "frontend-implementation", "running");

  markTaskExecutionRunning("diag-cancel");
  markTaskExecutionCancellationRequested("diag-cancel");
  markTaskExecutionTerminal("diag-terminal", "completed");

  const diagnostics = getTaskExecutionDiagnostics();

  assert.equal(diagnostics.queuedTasks >= 1, true);
  assert.equal(diagnostics.runningTasks >= 1, true);
  assert.equal(diagnostics.cancelRequestedTasks >= 1, true);
  assert.equal(diagnostics.terminalTasks >= 1, true);
});
