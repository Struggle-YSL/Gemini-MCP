import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createSQLitePersistenceRuntime } from "../dist/sqlite-persistence.js";

function createDbPath(name) {
  const baseDir = path.join(process.cwd(), "test-tmp");
  mkdirSync(baseDir, { recursive: true });
  const workspaceRoot = path.join(baseDir, name);
  rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(workspaceRoot, { recursive: true });
  return path.join(workspaceRoot, "state.sqlite");
}

test("createSQLitePersistenceRuntime persists tasks, results, queue messages, and sessions across reloads", async () => {
  const dbPath = createDbPath("sqlite-persistence");
  const runtime = createSQLitePersistenceRuntime(dbPath);

  assert.ok(runtime, "node:sqlite runtime should be available on this Node version");

  const task = await runtime.taskStore.createTask(
    { ttl: 60000, pollInterval: 2500 },
    "request-1",
    { method: "tools/call", params: { name: "implement_frontend_task" } },
  );

  await runtime.taskStore.updateTaskStatus(task.taskId, "working", "generating");
  await runtime.taskMessageQueue.enqueue(task.taskId, {
    kind: "status",
    stage: "packaging",
  });
  await runtime.taskStore.storeTaskResult(task.taskId, "completed", {
    content: [{ type: "text", text: "done" }],
    structuredContent: { ok: true },
  });
  runtime.sessionStore.set({
    id: "session-1",
    nativeSessionId: "native-1",
    createdAt: 1,
    updatedAt: 2,
    turns: [
      {
        toolName: "generate_frontend_component",
        prompt: "build card",
        response: "card built",
        ts: 3,
      },
    ],
  });

  const reloaded = createSQLitePersistenceRuntime(dbPath);
  assert.ok(reloaded, "reloaded sqlite runtime should be available");

  const restoredTask = await reloaded.taskStore.getTask(task.taskId);
  const restoredResult = await reloaded.taskStore.getTaskResult(task.taskId);
  const restoredMessages = await reloaded.taskMessageQueue.dequeueAll(task.taskId);
  const restoredSession = reloaded.sessionStore.get("session-1");

  assert.deepEqual(reloaded.recovery, {
    interruptedTasksRecovered: 0,
    clearedQueuedMessages: 0,
  });
  assert.equal(restoredTask?.status, "completed");
  assert.equal(restoredTask?.pollInterval, 2500);
  assert.deepEqual(restoredResult, {
    content: [{ type: "text", text: "done" }],
    structuredContent: { ok: true },
  });
  assert.deepEqual(restoredMessages, [
    {
      kind: "status",
      stage: "packaging",
    },
  ]);
  assert.deepEqual(restoredSession, {
    id: "session-1",
    nativeSessionId: "native-1",
    createdAt: 1,
    updatedAt: 2,
    turns: [
      {
        toolName: "generate_frontend_component",
        prompt: "build card",
        response: "card built",
        ts: 3,
      },
    ],
  });
});

test("createSQLitePersistenceRuntime marks interrupted non-terminal tasks as failed on restart", async () => {
  const dbPath = createDbPath("sqlite-recovery");
  const runtime = createSQLitePersistenceRuntime(dbPath);

  assert.ok(runtime, "node:sqlite runtime should be available on this Node version");

  const task = await runtime.taskStore.createTask(
    { ttl: 60000, pollInterval: 2000 },
    "request-2",
    { method: "tools/call", params: { name: "implement_frontend_task" } },
  );

  await runtime.taskStore.updateTaskStatus(task.taskId, "working", "queued: Waiting for execution slot");
  await runtime.taskMessageQueue.enqueue(task.taskId, {
    kind: "status",
    stage: "queued",
  });

  const reloaded = createSQLitePersistenceRuntime(dbPath);
  assert.ok(reloaded, "reloaded sqlite runtime should be available");

  const restoredTask = await reloaded.taskStore.getTask(task.taskId);
  const restoredMessages = await reloaded.taskMessageQueue.dequeueAll(task.taskId);

  assert.deepEqual(reloaded.recovery, {
    interruptedTasksRecovered: 1,
    clearedQueuedMessages: 1,
  });
  assert.equal(restoredTask?.status, "failed");
  assert.match(restoredTask?.statusMessage ?? "", /server restart before completion/i);
  assert.deepEqual(restoredMessages, []);
  await assert.rejects(() => reloaded.taskStore.getTaskResult(task.taskId));
});
