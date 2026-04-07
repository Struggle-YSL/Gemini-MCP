import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSQLitePersistenceRuntime } from "../dist/sqlite-persistence.js";
import { createWorkItem } from "../dist/orchestrator-state.js";
import {
  applyOrchestratorResolution,
  getOrchestratorResolution,
} from "../dist/orchestrator-resolution.js";

const projectContext = {
  design_system: "internal admin ui",
  existing_components: "Card, Drawer, Badge",
  conventions: "React + TypeScript",
};

function createRuntime() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "gemini-mcp-orchestrator-resolution-"));
  const dbPath = path.join(tempRoot, "state.sqlite");
  const runtime = createSQLitePersistenceRuntime(dbPath);
  assert.ok(runtime, "expected SQLite persistence runtime to be available");
  return runtime;
}

test("getOrchestratorResolution returns recommended actions for manual-review runs", () => {
  const runtime = createRuntime();
  const workItems = [
    createWorkItem({
      id: "frontend-code-1",
      type: "frontend-code",
      owner: "gemini",
      scope: "Build compare drawer",
      status: "failed",
    }),
    createWorkItem({
      id: "backend-1",
      type: "backend",
      owner: "codex",
      scope: "Implement API",
    }),
  ];

  runtime.orchestratorStore.saveOrchestratorSnapshot({
    orchestratorId: "resolution-1",
    graph: { schema_version: "1.0", work_items: workItems },
    state: {
      schema_version: "1.0",
      work_items: workItems,
      task_bindings: [],
      frontend_threads: [],
      work_item_results: [],
    },
    summary: {
      status: "ok",
      message: "manual review needed",
      ready_work_item_ids: [],
      waiting_work_item_ids: [],
      completed_work_item_ids: [],
      failed_work_item_ids: ["frontend-code-1"],
    },
    context: {
      project_context: projectContext,
    },
    runtime: {
      status: "manual-review-required",
      active: false,
      updated_at: new Date().toISOString(),
      last_tick_at: new Date().toISOString(),
      manual_actions: [
        {
          work_item_id: "frontend-code-1",
          owner: "gemini",
          reason: "frontend task failed",
          suggested_action: "retry manually",
          created_at: new Date().toISOString(),
        },
      ],
    },
  });

  const resolution = getOrchestratorResolution(
    { orchestrator_id: "resolution-1" },
    { orchestratorStore: runtime.orchestratorStore },
  );

  assert.equal(resolution.run_status, "manual-review-required");
  assert.ok(resolution.recommended_actions.some((item) => item.work_item_id === "frontend-code-1" && item.kind === "retry-work-item"));
  assert.ok(resolution.recommended_actions.some((item) => item.work_item_id === "backend-1" && item.kind === "provide-result"));
});

test("applyOrchestratorResolution accepts codex result and completes work item", () => {
  const runtime = createRuntime();
  const workItems = [
    createWorkItem({
      id: "backend-1",
      type: "backend",
      owner: "codex",
      scope: "Implement API",
    }),
  ];

  runtime.orchestratorStore.saveOrchestratorSnapshot({
    orchestratorId: "resolution-2",
    graph: { schema_version: "1.0", work_items: workItems },
    state: {
      schema_version: "1.0",
      work_items: workItems,
      task_bindings: [],
      frontend_threads: [],
      work_item_results: [],
    },
    summary: {
      status: "ok",
      message: "waiting for codex",
      ready_work_item_ids: ["backend-1"],
      waiting_work_item_ids: [],
      completed_work_item_ids: [],
      failed_work_item_ids: [],
    },
    context: {
      project_context: projectContext,
    },
    runtime: {
      status: "waiting_for_codex",
      active: false,
      updated_at: new Date().toISOString(),
      last_tick_at: new Date().toISOString(),
    },
  });

  const result = applyOrchestratorResolution(
    {
      orchestrator_id: "resolution-2",
      resolutions: [
        {
          kind: "provide-result",
          work_item_id: "backend-1",
          result: { ok: true },
        },
      ],
    },
    { orchestratorStore: runtime.orchestratorStore },
  );

  assert.equal(result.state.work_items[0].status, "completed");
  assert.deepEqual(result.state.work_item_results[0].payload, { ok: true });
  assert.equal(result.final_summary.status, "completed");
});

test("applyOrchestratorResolution retries gemini work item and reactivates runtime", () => {
  const runtime = createRuntime();
  const workItems = [
    createWorkItem({
      id: "frontend-code-1",
      type: "frontend-code",
      owner: "gemini",
      scope: "Build compare drawer",
      status: "failed",
    }),
  ];

  runtime.orchestratorStore.saveOrchestratorSnapshot({
    orchestratorId: "resolution-3",
    graph: { schema_version: "1.0", work_items: workItems },
    state: {
      schema_version: "1.0",
      work_items: workItems,
      task_bindings: [
        {
          task_id: "task-1",
          work_item_id: "frontend-code-1",
          tool_name: "implement_frontend_task",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      frontend_threads: [],
      work_item_results: [
        {
          work_item_id: "frontend-code-1",
          payload: { error: true },
          updated_at: new Date().toISOString(),
        },
      ],
    },
    summary: {
      status: "ok",
      message: "manual review needed",
      ready_work_item_ids: [],
      waiting_work_item_ids: [],
      completed_work_item_ids: [],
      failed_work_item_ids: ["frontend-code-1"],
    },
    context: {
      project_context: projectContext,
    },
    runtime: {
      status: "manual-review-required",
      active: false,
      updated_at: new Date().toISOString(),
      last_tick_at: new Date().toISOString(),
      manual_actions: [
        {
          work_item_id: "frontend-code-1",
          owner: "gemini",
          reason: "frontend task failed",
          suggested_action: "retry manually",
          created_at: new Date().toISOString(),
        },
      ],
    },
  });

  let registered = false;
  const result = applyOrchestratorResolution(
    {
      orchestrator_id: "resolution-3",
      resolutions: [
        {
          kind: "retry-work-item",
          work_item_id: "frontend-code-1",
        },
      ],
    },
    {
      orchestratorStore: runtime.orchestratorStore,
      runtimeManager: {
        register() {
          registered = true;
          return true;
        },
      },
    },
  );

  assert.equal(result.state.work_items[0].status, "queued");
  assert.equal(result.state.task_bindings.length, 0);
  assert.equal(result.state.work_item_results.length, 0);
  assert.equal(result.reactivated_runtime, true);
  assert.equal(registered, true);
  assert.equal(result.runtime?.status, "queued");
});