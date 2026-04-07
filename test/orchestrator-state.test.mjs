import test from "node:test";
import assert from "node:assert/strict";

import {
  bindFrontendThread,
  bindTaskToWorkItem,
  createOrchestratorState,
  createWorkItem,
  getBoundTaskForWorkItem,
  getFrontendThreadForSession,
  getReadyWorkItems,
  setWorkItemResult,
  transitionWorkItemStatus,
  validateExecutionGraph,
} from "../dist/orchestrator-state.js";

test("validateExecutionGraph accepts a valid DAG and returns topological order", () => {
  const report = validateExecutionGraph({
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "backend-1",
        type: "backend",
        owner: "codex",
        scope: "Implement API",
      }),
      createWorkItem({
        id: "frontend-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "Implement page",
        deps: ["backend-1"],
      }),
      createWorkItem({
        id: "integration-1",
        type: "integration",
        owner: "codex",
        scope: "Wire results",
        deps: ["frontend-1"],
      }),
    ],
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.ordered_work_item_ids, ["backend-1", "frontend-1", "integration-1"]);
});

test("validateExecutionGraph reports missing dependency cycle and owner mismatch", () => {
  const report = validateExecutionGraph({
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "frontend-1",
        type: "frontend-code",
        owner: "codex",
        scope: "Wrong owner",
        deps: ["missing-1", "frontend-2"],
      }),
      createWorkItem({
        id: "frontend-2",
        type: "frontend-plan",
        owner: "gemini",
        scope: "Cycle",
        deps: ["frontend-1"],
      }),
    ],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code).sort(),
    ["cyclic-dependency", "cyclic-dependency", "invalid-owner", "missing-dependency"].sort(),
  );
});

test("getReadyWorkItems and transitionWorkItemStatus respect dependency completion", () => {
  const graph = {
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "backend-1",
        type: "backend",
        owner: "codex",
        scope: "API",
        status: "completed",
      }),
      createWorkItem({
        id: "frontend-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "UI",
        deps: ["backend-1"],
      }),
      createWorkItem({
        id: "integration-1",
        type: "integration",
        owner: "codex",
        scope: "Integration",
        deps: ["frontend-1"],
      }),
    ],
  };

  assert.deepEqual(getReadyWorkItems(graph).map((item) => item.id), ["frontend-1"]);

  const state = createOrchestratorState(graph);
  const workingState = transitionWorkItemStatus(state, "frontend-1", "working");
  const completedState = transitionWorkItemStatus(workingState, "frontend-1", "completed");

  assert.deepEqual(getReadyWorkItems({
    schema_version: completedState.schema_version,
    work_items: completedState.work_items,
  }).map((item) => item.id), ["integration-1"]);

  assert.throws(() => transitionWorkItemStatus(state, "integration-1", "working"), /dependency 'frontend-1'/i);
});

test("bindTaskToWorkItem bindFrontendThread and setWorkItemResult update orchestrator state", () => {
  const graph = {
    schema_version: "1.0",
    work_items: [
      createWorkItem({
        id: "frontend-plan-1",
        type: "frontend-plan",
        owner: "gemini",
        scope: "Plan frontend",
      }),
      createWorkItem({
        id: "frontend-code-1",
        type: "frontend-code",
        owner: "gemini",
        scope: "Build frontend",
      }),
    ],
  };

  const baseState = createOrchestratorState(graph);
  const taskBoundState = bindTaskToWorkItem(baseState, {
    task_id: "task-1",
    work_item_id: "frontend-code-1",
    tool_name: "implement_frontend_task",
    session_id: "session-1",
  });
  const threadBoundState = bindFrontendThread(taskBoundState, {
    session_id: "session-1",
    thread_id: "thread-frontend-1",
    work_item_ids: ["frontend-plan-1", "frontend-code-1"],
  });
  const resultState = setWorkItemResult(threadBoundState, "frontend-code-1", {
    task_id: "task-1",
    status: "completed",
  });

  assert.equal(getBoundTaskForWorkItem(resultState, "frontend-code-1")?.task_id, "task-1");
  assert.deepEqual(
    getFrontendThreadForSession(resultState, "session-1")?.work_item_ids,
    ["frontend-plan-1", "frontend-code-1"],
  );
  assert.deepEqual(resultState.work_item_results[0].payload, {
    task_id: "task-1",
    status: "completed",
  });
});
