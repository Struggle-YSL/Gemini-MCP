import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getOrchestratorSummary } from "../dist/orchestrator-runtime.js";
import { createSQLitePersistenceRuntime } from "../dist/sqlite-persistence.js";
import { OrchestratorRuntimeManager } from "../dist/orchestrator-runtime-manager.js";
import { createWorkItem } from "../dist/orchestrator-state.js";

const projectContext = {
  design_system: "internal admin ui",
  existing_components: "Card, Drawer, Badge",
  conventions: "React + TypeScript",
};

function createRuntime() {
  const tempRoot = mkdtempSync(
    path.join(tmpdir(), "gemini-mcp-orchestrator-summary-"),
  );
  const dbPath = path.join(tempRoot, "state.sqlite");
  const runtime = createSQLitePersistenceRuntime(dbPath);
  assert.ok(runtime, "expected SQLite persistence runtime to be available");
  return runtime;
}

function createQueuedSnapshot(orchestratorId, workItems) {
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
      ready_work_item_ids: workItems.map((item) => item.id),
      waiting_work_item_ids: [],
      completed_work_item_ids: [],
      failed_work_item_ids: [],
    },
    context: {
      project_context: projectContext,
    },
  };
}

test("OrchestratorRuntimeManager retries failed gemini work and records final summary", async () => {
  const runtime = createRuntime();
  const workItems = [
    createWorkItem({
      id: "frontend-plan-1",
      type: "frontend-plan",
      owner: "gemini",
      scope: "Plan compare drawer",
    }),
  ];
  runtime.orchestratorStore.saveOrchestratorSnapshot(
    createQueuedSnapshot("retry-1", workItems),
  );

  let attempts = 0;
  const manager = new OrchestratorRuntimeManager({
    orchestratorStore: runtime.orchestratorStore,
    maxGeminiRetries: 2,
    tickMs: 15,
    maxActiveRuns: 1,
    runner: {
      run: async (input) => {
        attempts += 1;
        if (attempts === 1) {
          runtime.orchestratorStore.saveOrchestratorSnapshot({
            orchestratorId: input.orchestrator_id,
            graph: input.graph,
            state: {
              ...input.state,
              work_items: input.state.work_items.map((item) => ({
                ...item,
                status: "failed",
              })),
            },
            summary: {
              status: "ok",
              message: "first failure",
              ready_work_item_ids: [],
              waiting_work_item_ids: [],
              completed_work_item_ids: [],
              failed_work_item_ids: input.state.work_items.map(
                (item) => item.id,
              ),
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
              work_items: input.state.work_items.map((item) => ({
                ...item,
                status: "failed",
              })),
            },
            submitted_tasks: [],
            codex_actions: [],
            blocked_work_items: [],
            graph_validation_issues: [],
            summary: {
              status: "ok",
              message: "first failure",
              ready_work_item_ids: [],
              waiting_work_item_ids: [],
              completed_work_item_ids: [],
              failed_work_item_ids: input.state.work_items.map(
                (item) => item.id,
              ),
            },
          };
        }

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
            message: "completed after retry",
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: input.state.work_items.map(
              (item) => item.id,
            ),
            failed_work_item_ids: [],
          },
          context: {
            project_context: input.project_context,
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
            message: "completed after retry",
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
  await new Promise((resolve) => setTimeout(resolve, 220));
  manager.stop();

  assert.equal(attempts, 2);
  const summary = getOrchestratorSummary(
    { orchestrator_id: "retry-1" },
    { orchestratorStore: runtime.orchestratorStore },
  );
  assert.equal(summary.summary.status, "completed");
  assert.equal(summary.summary.completed_work_items.length, 1);
  assert.ok(
    summary.events.some((event) => event.event_type === "retry-scheduled"),
  );
  assert.ok(
    summary.events.some((event) => event.event_type === "run-completed"),
  );
});

test("OrchestratorRuntimeManager escalates repeated gemini failure to manual review summary", async () => {
  const runtime = createRuntime();
  const workItems = [
    createWorkItem({
      id: "frontend-code-1",
      type: "frontend-code",
      owner: "gemini",
      scope: "Build compare drawer",
    }),
  ];
  runtime.orchestratorStore.saveOrchestratorSnapshot(
    createQueuedSnapshot("manual-1", workItems),
  );

  let attempts = 0;
  const manager = new OrchestratorRuntimeManager({
    orchestratorStore: runtime.orchestratorStore,
    maxGeminiRetries: 1,
    tickMs: 15,
    maxActiveRuns: 1,
    runner: {
      run: async (input) => {
        attempts += 1;
        runtime.orchestratorStore.saveOrchestratorSnapshot({
          orchestratorId: input.orchestrator_id,
          graph: input.graph,
          state: {
            ...input.state,
            work_items: input.state.work_items.map((item) => ({
              ...item,
              status: "failed",
            })),
          },
          summary: {
            status: "ok",
            message: `failure-${attempts}`,
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: [],
            failed_work_item_ids: input.state.work_items.map((item) => item.id),
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
            work_items: input.state.work_items.map((item) => ({
              ...item,
              status: "failed",
            })),
          },
          submitted_tasks: [],
          codex_actions: [],
          blocked_work_items: [],
          graph_validation_issues: [],
          summary: {
            status: "ok",
            message: `failure-${attempts}`,
            ready_work_item_ids: [],
            waiting_work_item_ids: [],
            completed_work_item_ids: [],
            failed_work_item_ids: input.state.work_items.map((item) => item.id),
          },
        };
      },
    },
  });

  manager.start();
  await new Promise((resolve) => setTimeout(resolve, 260));
  manager.stop();

  assert.equal(attempts, 2);
  const summary = getOrchestratorSummary(
    { orchestrator_id: "manual-1" },
    { orchestratorStore: runtime.orchestratorStore },
  );
  assert.equal(summary.summary.status, "manual-review-required");
  assert.equal(summary.summary.pending_manual_actions.length, 1);
  assert.ok(
    summary.events.some(
      (event) => event.event_type === "manual-review-required",
    ),
  );
  assert.ok(summary.summary.natural_language_summary.includes("manual action"));
});
