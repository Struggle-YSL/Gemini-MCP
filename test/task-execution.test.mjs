import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  formatTaskProgressStatus,
  getTaskExecutionFailureDiagnostics,
  markTaskExecutionFailed,
  registerTaskExecution,
  TaskExecutionScheduler,
} from "../dist/task-execution.js";

async function waitFor(predicate, timeoutMs = 250) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for scheduler state");
    }
    await delay(5);
  }
}

test("formatTaskProgressStatus renders stage and detail for task status messages", () => {
  assert.equal(formatTaskProgressStatus("queued"), "queued");
  assert.equal(
    formatTaskProgressStatus(
      "generating",
      "Running Gemini for structured patch generation",
    ),
    "generating: Running Gemini for structured patch generation",
  );
});

test("TaskExecutionScheduler enforces FIFO execution when concurrency is 1", async () => {
  const scheduler = new TaskExecutionScheduler(1);
  const events = [];
  let releaseFirst;

  scheduler.enqueue(async () => {
    events.push("first-start");
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    events.push("first-end");
  });

  scheduler.enqueue(async () => {
    events.push("second-start");
    events.push("second-end");
  });

  await waitFor(() => events.includes("first-start"));
  assert.deepEqual(events, ["first-start"]);

  releaseFirst();
  await waitFor(() => events.includes("second-end"));
  assert.deepEqual(events, [
    "first-start",
    "first-end",
    "second-start",
    "second-end",
  ]);
});

test("TaskExecutionScheduler starts multiple tasks when concurrency allows it", async () => {
  const scheduler = new TaskExecutionScheduler(2);
  const events = [];
  let releaseFirst;
  let releaseSecond;

  scheduler.enqueue(async () => {
    events.push("first-start");
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    events.push("first-end");
  });

  scheduler.enqueue(async () => {
    events.push("second-start");
    await new Promise((resolve) => {
      releaseSecond = resolve;
    });
    events.push("second-end");
  });

  scheduler.enqueue(async () => {
    events.push("third-start");
    events.push("third-end");
  });

  await waitFor(() => events.includes("second-start"));
  assert.deepEqual(events, ["first-start", "second-start"]);
  assert.deepEqual(scheduler.getStats(), {
    activeCount: 2,
    pendingCount: 1,
    concurrencyLimit: 2,
  });

  releaseFirst();
  await waitFor(() => events.includes("third-end"));
  releaseSecond();
  await waitFor(() => events.includes("second-end"));
});

test("Task execution failure diagnostics aggregate structured failure kinds", () => {
  const failureTaskId = `failure-${Date.now()}`;
  registerTaskExecution(
    failureTaskId,
    "implement_frontend_task",
    "frontend-implementation",
    "running",
  );
  markTaskExecutionFailed(failureTaskId, {
    kind: "timeout",
    message: "timed out",
    retryable: true,
  });

  const diagnostics = getTaskExecutionFailureDiagnostics();
  assert.equal(diagnostics.totalFailedTasks >= 1, true);
  assert.equal(diagnostics.structuredFailureTasks >= 1, true);
  assert.equal(diagnostics.retryableFailures >= 1, true);
  assert.equal((diagnostics.failureKinds.timeout ?? 0) >= 1, true);
});
