import type {
  ExecutionGraphIssue,
  OrchestratorState,
  WorkItem,
} from "./orchestrator-state.js";
import {
  type BlockedWorkItem,
  type CodexWorkAction,
  type GeminiCodeAction,
  type GeminiPlanAction,
  type OrchestratorNextAction,
  type OrchestratorRuntimeSummary,
  type RunOrchestratorGraphInput,
  type WorkItemRuntimeInput,
} from "./orchestrator-runtime-schemas.js";
import { findReusableSessionId } from "./orchestrator-runtime-sync.js";

export function createCodexAction(workItem: WorkItem): CodexWorkAction {
  return {
    kind: "codex-work",
    work_item_id: workItem.id,
    title: `${workItem.type}: ${workItem.scope}`,
    instructions: `Execute work item '${workItem.id}' locally in Codex, then write the result back into state.work_item_results and rerun run_orchestrator_graph.`,
    payload: {
      scope: workItem.scope,
      input: workItem.input,
      acceptance: workItem.acceptance,
    },
  };
}

export function createGeminiPlanAction(
  workItem: WorkItem,
  runtimeInput: WorkItemRuntimeInput,
  input: RunOrchestratorGraphInput,
  state: OrchestratorState,
): GeminiPlanAction {
  const sessionId = findReusableSessionId(
    state,
    workItem.id,
    runtimeInput.session_id,
  );

  return {
    kind: "gemini-plan",
    work_item_id: workItem.id,
    title: `${workItem.type}: ${workItem.scope}`,
    tool_name: "plan_frontend_solution",
    arguments: {
      goal: runtimeInput.goal ?? runtimeInput.task_goal ?? workItem.scope,
      scope: runtimeInput.scope ?? [workItem.scope],
      constraints: runtimeInput.constraints,
      backend_contracts:
        runtimeInput.backend_contracts ?? input.backend_contracts,
      acceptance_criteria:
        runtimeInput.acceptance_criteria ?? input.acceptance_criteria,
      session_id: sessionId,
      project_context: input.project_context,
    },
  };
}

export function createGeminiCodeAction(
  workItem: WorkItem,
  runtimeInput: WorkItemRuntimeInput,
  input: RunOrchestratorGraphInput,
  state: OrchestratorState,
): GeminiCodeAction {
  const sessionId = findReusableSessionId(
    state,
    workItem.id,
    runtimeInput.session_id,
  );

  return {
    kind: "gemini-code",
    work_item_id: workItem.id,
    title: `${workItem.type}: ${workItem.scope}`,
    tool_name: "implement_frontend_task",
    arguments: {
      task_goal: runtimeInput.task_goal ?? runtimeInput.goal ?? workItem.scope,
      related_files: runtimeInput.related_files,
      allowed_paths: runtimeInput.allowed_paths ?? [],
      backend_contracts:
        runtimeInput.backend_contracts ?? input.backend_contracts,
      acceptance_criteria:
        runtimeInput.acceptance_criteria ?? input.acceptance_criteria,
      session_id: sessionId,
      project_context: input.project_context,
    },
  };
}

export function createGraphIssueBlocks(
  issues: ExecutionGraphIssue[],
): BlockedWorkItem[] {
  return issues.map((issue) => ({
    work_item_id: issue.work_item_id ?? issue.dependency_id ?? "graph",
    owner: issue.code === "invalid-owner" ? "gemini" : "codex",
    category: "graph-invalid",
    reason: issue.message,
  }));
}

export function createSummary(
  status: "ok" | "invalid-graph",
  nextActions: OrchestratorNextAction[],
  blockedWorkItems: BlockedWorkItem[],
  state: OrchestratorState,
  validationIssues: ExecutionGraphIssue[],
): OrchestratorRuntimeSummary {
  const completed = state.work_items
    .filter((item) => item.status === "completed")
    .map((item) => item.id);
  const failed = state.work_items
    .filter((item) => item.status === "failed")
    .map((item) => item.id);
  const ready = nextActions.map((item) => item.work_item_id);
  const waiting = [
    ...new Set(blockedWorkItems.map((item) => item.work_item_id)),
  ];

  const message =
    status === "invalid-graph"
      ? `Execution graph is invalid: ${validationIssues.length} issue(s) must be resolved before orchestration can advance.`
      : `Graph advanced: ${ready.length} ready action(s), ${waiting.length} waiting item(s), ${completed.length} completed, ${failed.length} failed.`;

  return {
    status,
    message,
    ready_work_item_ids: ready,
    waiting_work_item_ids: waiting,
    completed_work_item_ids: completed,
    failed_work_item_ids: failed,
  };
}

export function isTerminalOrchestratorState(state: OrchestratorState): boolean {
  return state.work_items.every(
    (item) => item.status === "completed" || item.status === "failed",
  );
}
