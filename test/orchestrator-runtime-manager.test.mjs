import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSQLitePersistenceRuntime } from "../dist/sqlite-persistence.js";
import { OrchestratorRuntimeManager } from "../dist/orchestrator-runtime-manager.js";
import { createWorkItem } from "../dist/orchestrator-state.js";
import { createTaskFailureResult } from "../dist/error-model.js";

const projectContext = {
  design_system: "internal admin ui",
  existing_components: "Card, Drawer, Badge",
  conventions: "React + TypeScript",
};

function createRuntime() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "gemini-mcp-orchestrator-manager-"));
  const dbPath = path.join(tempRoot, "state.sqlite");
  const runtime = createSQLitePersistenceRuntime(dbPath);
  assert.ok(runtime, "expected SQLite persistence runtime to be available");
  return runtime;
}

function createQueuedSnapshot(orchestratorId, workItems, readyIds = workItems.map((item) => item.id)) {
  return {
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
      ready_work_item_ids: readyIds,
      waiting_work_item_ids: [],
      completed_work_item_ids: [],
      failed_work_item_ids: [],
    },
    context: {
      project_context: projectContext,
    },
  };
}

test("OrchestratorRuntimeManager recovers persisted unfinished runs on startup", async () => {
  const runtime = createRuntime();
  runtime.orchestratorStore.saveOrchestratorSnapshot(
    createQueuedSnapshot("recover-1", [
      createWorkItem({
        id: "frontend-plan-1",
        type: "frontend-plan",
        owner: "gemini",
        scope: "Plan compare drawer",
      }),
    ]),
  );

  const calls = [];
  const manager = new OrchestratorRuntimeManager({
    orchestratorStore: runtime.orchestratorStore,
    runner: {
      run: async (input) => {
        calls.push(input.orchestrator_id);
        runtime.orchestratorStore.saveOrchestratorSnapshot({
          orchestratorId: input.orchestrator_id,
          graph: input.graph,
          state: {
            ...input.state,
            work_items: input.state.work_items.map((item) => ({ ...item, status: "completed" })),
          },
          summary: {
            status: "ok",
            message: "done",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: input.state.work_items.map((item) => item.id),
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
            work_items: input.state.work_items.map((item) => ({ ...item, status: "completed" })),
          },
          submitted_tasks: [],
          codex_actions: [],
          blocked_work_items: [],
          graph_validation_issues: [],
          summary: {
            status: "ok",
            message: "done",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: input.state.work_items.map((item) => item.id),
            failed_work_item_ids: [],
          },
        };
      },
    },
    tickMs: 20,
    maxActiveRuns: 1,
  });

  manager.start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  manager.stop();

  assert.deepEqual(calls, ["recover-1"]);
  const snapshot = runtime.orchestratorStore.loadOrchestratorSnapshot("recover-1");
  assert.equal(snapshot?.runtime?.status, "completed");
  assert.equal(manager.getDiagnostics().recovered_runs, 1);
});

test("OrchestratorRuntimeManager keeps gemini branch moving when codex work is also ready", async () => {
  const runtime = createRuntime();
  runtime.orchestratorStore.saveOrchestratorSnapshot(
    createQueuedSnapshot("mixed-1", [
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
    ]),
  );

  const manager = new OrchestratorRuntimeManager({
    orchestratorStore: runtime.orchestratorStore,
    taskStore: runtime.taskStore,
    geminiTaskSubmitter: {
      submit: async (action) => ({
        work_item_id: action.work_item_id,
        task_id: `task-${action.work_item_id}`,
        tool_name: action.tool_name,
        session_id: "session-1",
      }),
    },
    tickMs: 20,
    maxActiveRuns: 1,
  });

  manager.start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  manager.stop();

  const snapshot = runtime.orchestratorStore.loadOrchestratorSnapshot("mixed-1");
  assert.equal(snapshot?.state.task_bindings[0]?.work_item_id, "frontend-plan-1");
  assert.equal(snapshot?.runtime?.status, "running");
});

test("OrchestratorRuntimeManager enforces maxActiveRuns while draining queued runs", async () => {
  const runtime = createRuntime();
  for (const orchestratorId of ["run-1", "run-2", "run-3"]) {
    runtime.orchestratorStore.saveOrchestratorSnapshot(
      createQueuedSnapshot(orchestratorId, [
        createWorkItem({
          id: `${orchestratorId}-plan`,
          type: "frontend-plan",
          owner: "gemini",
          scope: "Plan work",
        }),
      ]),
    );
  }

  let active = 0;
  let maxObserved = 0;
  const calls = [];
  const manager = new OrchestratorRuntimeManager({
    orchestratorStore: runtime.orchestratorStore,
    runner: {
      run: async (input) => {
        calls.push(input.orchestrator_id);
        active += 1;
        maxObserved = Math.max(maxObserved, active);
        await new Promise((resolve) => setTimeout(resolve, 40));
        active -= 1;
        runtime.orchestratorStore.saveOrchestratorSnapshot({
          orchestratorId: input.orchestrator_id,
          graph: input.graph,
          state: {
            ...input.state,
            work_items: input.state.work_items.map((item) => ({ ...item, status: "completed" })),
          },
          summary: {
            status: "ok",
            message: "done",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: input.state.work_items.map((item) => item.id),
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
            work_items: input.state.work_items.map((item) => ({ ...item, status: "completed" })),
          },
          submitted_tasks: [],
          codex_actions: [],
          blocked_work_items: [],
          graph_validation_issues: [],
          summary: {
            status: "ok",
            message: "done",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: input.state.work_items.map((item) => item.id),
            failed_work_item_ids: [],
          },
        };
      },
    },
    tickMs: 10,
    maxActiveRuns: 1,
  });

  manager.start();
  await new Promise((resolve) => setTimeout(resolve, 260));
  manager.stop();

  assert.equal(maxObserved, 1);
  assert.equal(calls.length, 3);
});


test("OrchestratorRuntimeManager manual review captures structured task failure details", async () => {
  const runtime = createRuntime();
  runtime.orchestratorStore.saveOrchestratorSnapshot(
    createQueuedSnapshot("manual-error-1", [
      createWorkItem({
        id: "frontend-code-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "Build compare drawer",
      }),
    ]),
  );

  const manager = new OrchestratorRuntimeManager({
    orchestratorStore: runtime.orchestratorStore,
    maxGeminiRetries: 0,
    tickMs: 15,
    maxActiveRuns: 1,
    runner: {
      run: async (input) => {
        const failurePayload = {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "failed",
              progress_stage: "failed",
              error: {
                kind: "auth",
                message: "Gemini auth required",
                retryable: false,
              },
            }),
          }],
          structuredContent: {
            status: "failed",
            progress_stage: "failed",
            error: {
              kind: "auth",
              message: "Gemini auth required",
              retryable: false,
            },
          },
        };

        runtime.orchestratorStore.saveOrchestratorSnapshot({
          orchestratorId: input.orchestrator_id,
          graph: input.graph,
          state: {
            ...input.state,
            work_items: input.state.work_items.map((item) => ({ ...item, status: "failed" })),
            task_bindings: [
              {
                task_id: "task-frontend-code-1",
                work_item_id: "frontend-code-1",
                tool_name: "implement_frontend_task",
                session_id: "session-1",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            work_item_results: [
              {
                work_item_id: "frontend-code-1",
                payload: failurePayload,
                updated_at: new Date().toISOString(),
              },
            ],
          },
          summary: {
            status: "ok",
            message: "failed once",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: [],
            failed_work_item_ids: ["frontend-code-1"],
          },
          context: {
            project_context: input.project_context,
          },
          runtime: {
            status: "failed",
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
            work_items: input.state.work_items.map((item) => ({ ...item, status: "failed" })),
            task_bindings: [
              {
                task_id: "task-frontend-code-1",
                work_item_id: "frontend-code-1",
                tool_name: "implement_frontend_task",
                session_id: "session-1",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            work_item_results: [
              {
                work_item_id: "frontend-code-1",
                payload: failurePayload,
                updated_at: new Date().toISOString(),
              },
            ],
          },
          submitted_tasks: [],
          codex_actions: [],
          blocked_work_items: [],
          graph_validation_issues: [],
          summary: {
            status: "ok",
            message: "failed once",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: [],
            failed_work_item_ids: ["frontend-code-1"],
          },
        };
      },
    },
  });

  manager.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  manager.stop();

  const snapshot = runtime.orchestratorStore.loadOrchestratorSnapshot("manual-error-1");
  assert.equal(snapshot?.runtime?.status, "manual-review-required");
  assert.match(snapshot?.runtime?.manual_actions?.[0]?.reason ?? "", /kind=auth/i);
  assert.match(snapshot?.runtime?.manual_actions?.[0]?.reason ?? "", /Gemini auth required/i);
});

