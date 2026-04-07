import test from "node:test";
import assert from "node:assert/strict";

import {
  isRecoverableOrchestratorSnapshot,
  mergePersistedSnapshotFields,
} from "../dist/sqlite-orchestrator-store-helpers.js";
import { createWorkItem } from "../dist/orchestrator-state.js";

function createSnapshot(status = "queued") {
  const workItem = createWorkItem({
    id: "work-1",
    type: "frontend-plan",
    owner: "gemini",
    scope: "plan drawer",
    status,
  });

  return {
    orchestrator_id: "orchestrator-1",
    graph: {
      schema_version: "1.0",
      work_items: [workItem],
    },
    state: {
      schema_version: "1.0",
      work_items: [workItem],
      task_bindings: [],
      frontend_threads: [],
      work_item_results: [],
    },
    summary: {
      status: "ok",
      message: "state",
      ready_work_item_ids: status === "queued" ? ["work-1"] : [],
      waiting_work_item_ids: [],
      completed_work_item_ids: status === "completed" ? ["work-1"] : [],
      failed_work_item_ids: status === "failed" ? ["work-1"] : [],
    },
    runtime: {
      status: "running",
      active: true,
      updated_at: "2026-04-03T00:00:00.000Z",
      last_tick_at: "2026-04-03T00:00:00.000Z",
    },
    updated_at: "2026-04-03T00:00:00.000Z",
  };
}

test("mergePersistedSnapshotFields merges runtime and keeps existing optional fields", () => {
  const existing = {
    ...createSnapshot(),
    context: {
      project_context: {
        design_system: "internal ui",
      },
    },
    events: [
      {
        level: "info",
        event_type: "run-started",
        ts: "now",
        message: "started",
      },
    ],
  };

  const merged = mergePersistedSnapshotFields(
    {
      orchestratorId: "orchestrator-1",
      graph: existing.graph,
      state: existing.state,
      summary: existing.summary,
      runtime: {
        status: "queued",
        active: true,
        updated_at: "2026-04-03T01:00:00.000Z",
      },
    },
    existing,
  );

  assert.equal(
    merged.mergedContext?.project_context.design_system,
    "internal ui",
  );
  assert.equal(merged.mergedRuntime?.status, "queued");
  assert.equal(merged.mergedRuntime?.last_tick_at, "2026-04-03T00:00:00.000Z");
  assert.equal(Array.isArray(merged.mergedEvents), true);
});

test("isRecoverableOrchestratorSnapshot returns false for terminal or invalid runtime states", () => {
  const queued = createSnapshot("queued");
  assert.equal(isRecoverableOrchestratorSnapshot(queued), true);

  const completed = createSnapshot("completed");
  assert.equal(isRecoverableOrchestratorSnapshot(completed), false);

  const invalidGraph = {
    ...createSnapshot("queued"),
    runtime: {
      ...createSnapshot("queued").runtime,
      status: "invalid-graph",
    },
  };
  assert.equal(isRecoverableOrchestratorSnapshot(invalidGraph), false);

  const failedRecovery = {
    ...createSnapshot("queued"),
    runtime: {
      ...createSnapshot("queued").runtime,
      status: "failed-recovery",
    },
  };
  assert.equal(isRecoverableOrchestratorSnapshot(failedRecovery), false);
});
