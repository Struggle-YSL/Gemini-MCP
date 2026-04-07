import test from "node:test";
import assert from "node:assert/strict";

import { resolveTaskExecutionOptions } from "../dist/task-tool-scheduling.js";

test("resolveTaskExecutionOptions uses defaults when execution options are omitted", () => {
  const resolved = resolveTaskExecutionOptions("implement_frontend_task", undefined);

  assert.deepEqual(resolved, {
    mode: "immediate",
    queueKey: "implement_frontend_task",
    concurrencyLimit: 1,
  });
});

test("resolveTaskExecutionOptions normalizes queueKey and keeps explicit mode/concurrency", () => {
  const resolved = resolveTaskExecutionOptions("implement_frontend_task", {
    mode: "queued",
    queueKey: "  frontend-queue  ",
    concurrencyLimit: 3,
  });

  assert.deepEqual(resolved, {
    mode: "queued",
    queueKey: "frontend-queue",
    concurrencyLimit: 3,
  });
});

test("resolveTaskExecutionOptions falls back to tool name when queueKey is blank", () => {
  const resolved = resolveTaskExecutionOptions("plan_frontend_solution", {
    mode: "queued",
    queueKey: "   ",
    concurrencyLimit: 2,
  });

  assert.equal(resolved.queueKey, "plan_frontend_solution");
});