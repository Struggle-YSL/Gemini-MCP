import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getOrchestratorState,
  runOrchestratorLoop,
} from "../dist/orchestrator-runtime.js";
import { createWorkItem } from "../dist/orchestrator-state.js";
import { createSQLitePersistenceRuntime } from "../dist/sqlite-persistence.js";

const projectContext = {
  design_system: "internal admin ui",
  existing_components: "Card, Drawer, Badge",
  conventions: "React + TypeScript",
};

test("runOrchestratorLoop submits ready gemini work and keeps codex actions visible", async () => {
  const submitted = [];
  const result = await runOrchestratorLoop(
    {
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
        ],
      },
      project_context: projectContext,
      max_submissions: 1,
    },
    {
      geminiTaskSubmitter: {
        submit: async (action) => {
          const submission = {
            work_item_id: action.work_item_id,
            task_id: `task-${action.work_item_id}`,
            tool_name: action.tool_name,
            session_id: "session-plan-1",
          };
          submitted.push(submission);
          return submission;
        },
      },
    },
  );

  assert.equal(submitted.length, 1);
  assert.equal(result.submitted_tasks.length, 1);
  assert.equal(result.submitted_tasks[0].work_item_id, "frontend-plan-1");
  assert.equal(result.state.task_bindings[0]?.task_id, "task-frontend-plan-1");
  assert.equal(result.state.frontend_threads[0]?.session_id, "session-plan-1");
  assert.deepEqual(
    result.codex_actions.map((item) => item.work_item_id),
    ["backend-1"],
  );
  assert.equal(result.blocked_work_items[0]?.work_item_id, "frontend-plan-1");
  assert.equal(result.blocked_work_items[0]?.category, "task-running");
});

test("runOrchestratorLoop respects max_submissions and leaves remaining gemini work ready", async () => {
  const result = await runOrchestratorLoop(
    {
      graph: {
        schema_version: "1.0",
        work_items: [
          createWorkItem({
            id: "frontend-plan-1",
            type: "frontend-plan",
            owner: "gemini",
            scope: "Plan compare drawer",
          }),
          createWorkItem({
            id: "frontend-plan-2",
            type: "frontend-plan",
            owner: "gemini",
            scope: "Plan detail modal",
          }),
        ],
      },
      project_context: projectContext,
      max_submissions: 1,
    },
    {
      geminiTaskSubmitter: {
        submit: async (action) => ({
          work_item_id: action.work_item_id,
          task_id: `task-${action.work_item_id}`,
          tool_name: action.tool_name,
        }),
      },
    },
  );

  assert.equal(result.submitted_tasks.length, 1);
  assert.equal(result.submitted_tasks[0].work_item_id, "frontend-plan-1");
  assert.deepEqual(result.summary.ready_work_item_ids, ["frontend-plan-2"]);
  assert.equal(result.state.task_bindings.length, 1);
});

test("runOrchestratorLoop persists submitted task bindings to SQLite snapshots", async () => {
  const tempRoot = mkdtempSync(
    path.join(tmpdir(), "gemini-mcp-orchestrator-loop-"),
  );
  const dbPath = path.join(tempRoot, "state.sqlite");
  const runtime = createSQLitePersistenceRuntime(dbPath);
  assert.ok(runtime, "expected SQLite persistence runtime to be available");

  const result = await runOrchestratorLoop(
    {
      orchestrator_id: "loop-1",
      persist: true,
      graph: {
        schema_version: "1.0",
        work_items: [
          createWorkItem({
            id: "frontend-code-1",
            type: "frontend-code",
            owner: "gemini",
            scope: "Build compare drawer",
          }),
        ],
      },
      project_context: projectContext,
      work_item_inputs: {
        "frontend-code-1": {
          task_goal: "Build compare drawer",
          allowed_paths: ["src/pages/**", "src/components/**"],
        },
      },
    },
    {
      orchestratorStore: runtime?.orchestratorStore,
      taskStore: runtime?.taskStore,
      geminiTaskSubmitter: {
        submit: async (action) => ({
          work_item_id: action.work_item_id,
          task_id: `task-${action.work_item_id}`,
          tool_name: action.tool_name,
        }),
      },
    },
  );

  assert.equal(result.persisted, true);
  assert.equal(result.submitted_tasks[0]?.task_id, "task-frontend-code-1");

  const stored = getOrchestratorState(
    {
      orchestrator_id: "loop-1",
    },
    {
      orchestratorStore: runtime?.orchestratorStore,
    },
  );

  assert.equal(
    stored.snapshot.state.task_bindings[0]?.task_id,
    "task-frontend-code-1",
  );
  assert.equal(
    stored.snapshot.state.task_bindings[0]?.work_item_id,
    "frontend-code-1",
  );
});
