import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import {
  getOrchestratorState,
  runOrchestratorGraph,
} from "../dist/orchestrator-runtime.js";
import {
  bindTaskToWorkItem,
  createOrchestratorState,
  createWorkItem,
  setWorkItemResult,
} from "../dist/orchestrator-state.js";
import { createSQLitePersistenceRuntime } from "../dist/sqlite-persistence.js";

const projectContext = {
  design_system: "internal admin ui",
  existing_components: "Card, Drawer, Badge",
  conventions: "React + TypeScript",
};

function createToolCallRequest(id) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "implement_frontend_task",
      arguments: {},
    },
  };
}

test("runOrchestratorGraph returns graph validation issues without actions for invalid DAG", async () => {
  const result = await runOrchestratorGraph({
    graph: {
      schema_version: "1.0",
      work_items: [
        createWorkItem({
          id: "frontend-1",
          type: "frontend-code",
          owner: "codex",
          scope: "Broken owner",
          deps: ["missing-1"],
        }),
      ],
    },
    project_context: projectContext,
  });

  assert.equal(result.summary.status, "invalid-graph");
  assert.equal(result.next_actions.length, 0);
  assert.equal(result.graph_validation_issues.length, 2);
});

test("runOrchestratorGraph emits codex and gemini actions for ready queued work items", async () => {
  const result = await runOrchestratorGraph({
    graph: {
      schema_version: "1.0",
      work_items: [
        createWorkItem({
          id: "backend-1",
          type: "backend",
          owner: "codex",
          scope: "Implement API",
        }),
        createWorkItem({
          id: "frontend-plan-1",
          type: "frontend-plan",
          owner: "gemini",
          scope: "Plan compare drawer",
        }),
        createWorkItem({
          id: "frontend-code-1",
          type: "frontend-code",
          owner: "gemini",
          scope: "Build compare drawer",
          deps: ["backend-1"],
        }),
      ],
    },
    project_context: projectContext,
    backend_contracts: ["GET /api/version/{id}"],
    work_item_inputs: {
      "frontend-plan-1": {
        goal: "Plan version compare drawer",
        scope: ["drawer", "badge", "mobile layout"],
      },
      "frontend-code-1": {
        task_goal: "Build version compare drawer",
        allowed_paths: ["src/pages/**", "src/components/**"],
      },
    },
  });

  assert.deepEqual(result.next_actions.map((item) => item.kind), ["codex-work", "gemini-plan"]);
  const planAction = result.next_actions.find((item) => item.kind === "gemini-plan");
  assert.equal(planAction?.tool_name, "plan_frontend_solution");
  assert.deepEqual(planAction?.arguments.scope, ["drawer", "badge", "mobile layout"]);
  assert.deepEqual(result.blocked_work_items, [
    {
      work_item_id: "frontend-code-1",
      owner: "gemini",
      category: "dependency",
      reason: "Waiting for dependencies: backend-1.",
    },
  ]);
});

test("runOrchestratorGraph completes work items from stored results and unlocks downstream actions", async () => {
  const graph = {
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "backend-1",
        type: "backend",
        owner: "codex",
        scope: "Implement API",
      }),
      createWorkItem({
        id: "frontend-code-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "Build compare drawer",
        deps: ["backend-1"],
      }),
      createWorkItem({
        id: "integration-1",
        type: "integration",
        owner: "codex",
        scope: "Wire page integration",
        deps: ["frontend-code-1"],
      }),
    ],
  };

  const stateWithBackendResult = setWorkItemResult(
    createOrchestratorState(graph),
    "backend-1",
    { ok: true },
    "2026-03-25T00:00:00.000Z",
  );

  const result = await runOrchestratorGraph({
    graph,
    state: stateWithBackendResult,
    project_context: projectContext,
    work_item_inputs: {
      "frontend-code-1": {
        task_goal: "Build compare drawer",
        allowed_paths: ["src/pages/**", "src/components/**"],
      },
    },
  });

  assert.equal(result.state.work_items.find((item) => item.id === "backend-1")?.status, "completed");
  assert.deepEqual(result.completed_work_items, ["backend-1"]);
  assert.deepEqual(result.next_actions.map((item) => item.kind), ["gemini-code"]);
  assert.deepEqual(result.summary.ready_work_item_ids, ["frontend-code-1"]);
});

test("runOrchestratorGraph waits for bound gemini task result and completes when snapshot arrives", async () => {
  const graph = {
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "frontend-code-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "Build compare drawer",
      }),
    ],
  };

  const boundState = bindTaskToWorkItem(createOrchestratorState(graph), {
    task_id: "task-1",
    work_item_id: "frontend-code-1",
    tool_name: "implement_frontend_task",
    session_id: "session-1",
  });

  const waitingResult = await runOrchestratorGraph({
    graph,
    state: boundState,
    project_context: projectContext,
  });
  assert.equal(waitingResult.next_actions.length, 0);
  assert.equal(waitingResult.blocked_work_items[0]?.category, "task-running");
  assert.equal(waitingResult.state.work_items[0].status, "working");

  const completedResult = await runOrchestratorGraph({
    graph,
    state: boundState,
    project_context: projectContext,
    task_results: [
      {
        task_id: "task-1",
        status: "completed",
        session_id: "session-1",
        thread_id: "thread-1",
        result: {
          task_id: "task-1",
          files: [],
        },
      },
    ],
  });

  assert.equal(completedResult.state.work_items[0].status, "completed");
  assert.equal(completedResult.completed_work_items[0], "frontend-code-1");
  assert.equal(completedResult.state.frontend_threads[0]?.thread_id, "thread-1");
});

test("runOrchestratorGraph auto-loads bound task snapshots from taskStore when load_if_exists is enabled", async () => {
  const taskStore = new InMemoryTaskStore();
  const task = await taskStore.createTask({ ttl: 60_000 }, "req-1", createToolCallRequest("req-1"));
  const graph = {
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "frontend-code-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "Build compare drawer",
      }),
    ],
  };

  const boundState = bindTaskToWorkItem(createOrchestratorState(graph), {
    task_id: task.taskId,
    work_item_id: "frontend-code-1",
    tool_name: "implement_frontend_task",
    session_id: "session-1",
  });

  const waiting = await runOrchestratorGraph({
    graph,
    state: boundState,
    project_context: projectContext,
    load_if_exists: true,
  }, {
    taskStore,
  });

  assert.equal(waiting.next_actions.length, 0);
  assert.equal(waiting.blocked_work_items[0]?.category, "working");
  assert.equal(waiting.state.work_items[0]?.status, "working");

  await taskStore.storeTaskResult(task.taskId, "completed", {
    content: [{ type: "text", text: "done" }],
    structuredContent: {
      schema_version: "1.0",
      session_id: "session-1",
      thread_id: "thread-1",
      task_id: task.taskId,
      status: "completed",
      progress_stage: "completed",
      files: [],
      validation_steps: [],
      open_questions: [],
      risks: [],
    },
  });

  const completed = await runOrchestratorGraph({
    graph,
    state: boundState,
    project_context: projectContext,
    load_if_exists: true,
  }, {
    taskStore,
  });

  assert.equal(completed.state.work_items[0]?.status, "completed");
  assert.equal(completed.state.frontend_threads[0]?.session_id, "session-1");
  assert.equal(completed.state.frontend_threads[0]?.thread_id, "thread-1");
  assert.equal(completed.state.work_item_results[0]?.payload?.structuredContent?.session_id, "session-1");
});

test("runOrchestratorGraph persists and reloads orchestrator snapshots when SQLite is available", async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "gemini-mcp-orchestrator-"));
  const dbPath = path.join(tempRoot, "state.sqlite");
  const runtime = createSQLitePersistenceRuntime(dbPath);
  assert.ok(runtime, "expected SQLite persistence runtime to be available");

  const graph = {
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "backend-1",
        type: "backend",
        owner: "codex",
        scope: "Implement API",
      }),
      createWorkItem({
        id: "frontend-code-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "Build compare drawer",
        deps: ["backend-1"],
      }),
    ],
  };

  const first = await runOrchestratorGraph({
    orchestrator_id: "orch-1",
    persist: true,
    graph,
    project_context: projectContext,
    work_item_inputs: {
      "frontend-code-1": {
        task_goal: "Build compare drawer",
        allowed_paths: ["src/pages/**", "src/components/**"],
      },
    },
  }, {
    orchestratorStore: runtime?.orchestratorStore,
    taskStore: runtime?.taskStore,
  });

  assert.equal(first.persisted, true);
  assert.equal(first.loaded_from_store, false);

  const stored = getOrchestratorState({
    orchestrator_id: "orch-1",
  }, {
    orchestratorStore: runtime?.orchestratorStore,
  });
  assert.equal(stored.snapshot.orchestrator_id, "orch-1");
  assert.equal(stored.snapshot.summary.ready_work_item_ids[0], "backend-1");

  runtime?.orchestratorStore.saveOrchestratorSnapshot({
    orchestratorId: "orch-1",
    graph,
    state: setWorkItemResult(createOrchestratorState(graph), "backend-1", { ok: true }),
    summary: first.summary,
  });

  const second = await runOrchestratorGraph({
    orchestrator_id: "orch-1",
    persist: true,
    load_if_exists: true,
    graph,
    project_context: projectContext,
    work_item_inputs: {
      "frontend-code-1": {
        task_goal: "Build compare drawer",
        allowed_paths: ["src/pages/**", "src/components/**"],
      },
    },
  }, {
    orchestratorStore: runtime?.orchestratorStore,
    taskStore: runtime?.taskStore,
  });

  assert.equal(second.loaded_from_store, true);
  assert.equal(second.state.work_items.find((item) => item.id === "backend-1")?.status, "completed");
  assert.deepEqual(second.summary.ready_work_item_ids, ["frontend-code-1"]);
});

test("runOrchestratorGraph reports persistence warning when SQLite store is unavailable", async () => {
  const result = await runOrchestratorGraph({
    orchestrator_id: "orch-mem-1",
    persist: true,
    graph: {
      schema_version: "1.0",
      work_items: [
        createWorkItem({
          id: "backend-1",
          type: "backend",
          owner: "codex",
          scope: "Implement API",
        }),
      ],
    },
    project_context: projectContext,
  });

  assert.equal(result.persisted, false);
  assert.match(result.persistence_warning ?? "", /SQLite persistence unavailable/i);
});