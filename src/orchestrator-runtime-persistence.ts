import { ORCHESTRATOR_SCHEMA_VERSION } from "./orchestrator-contracts.js";
import {
  runOrchestratorGraphOutputSchema,
  runOrchestratorLoopOutputSchema,
  persistedOrchestratorContextSchema,
  persistedOrchestratorRuntimeStateSchema,
  type BlockedWorkItem,
  type CodexWorkAction,
  type GeminiCodeAction,
  type GeminiPlanAction,
  type OrchestratorNextAction,
  type OrchestratorRuntimeSummary,
  type PersistedOrchestratorContext,
  type PersistedOrchestratorRuntimeState,
  type RunOrchestratorGraphInput,
  type RunOrchestratorGraphOutput,
  type RunOrchestratorLoopOutput,
  type SubmittedTask,
} from "./orchestrator-runtime-schemas.js";
import type {
  ExecutionGraphIssue,
  OrchestratorState,
} from "./orchestrator-state.js";
import { isTerminalOrchestratorState } from "./orchestrator-runtime-actions.js";

export function buildPersistedContext(
  input: RunOrchestratorGraphInput,
): PersistedOrchestratorContext {
  return persistedOrchestratorContextSchema.parse({
    project_context: input.project_context,
    backend_contracts: input.backend_contracts,
    acceptance_criteria: input.acceptance_criteria,
    work_item_inputs: input.work_item_inputs,
  });
}

function buildTerminalRuntimeState(
  state: OrchestratorState,
  updatedAt: string,
): PersistedOrchestratorRuntimeState {
  const hasFailures = state.work_items.some((item) => item.status === "failed");
  return persistedOrchestratorRuntimeStateSchema.parse({
    status: hasFailures ? "failed" : "completed",
    active: false,
    updated_at: updatedAt,
    last_tick_at: updatedAt,
  });
}

export function buildGraphRuntimeState(
  output: Pick<
    RunOrchestratorGraphOutput,
    "state" | "next_actions" | "blocked_work_items" | "summary"
  >,
  updatedAt: string,
): PersistedOrchestratorRuntimeState {
  if (output.summary.status === "invalid-graph") {
    return persistedOrchestratorRuntimeStateSchema.parse({
      status: "invalid-graph",
      active: false,
      updated_at: updatedAt,
      last_tick_at: updatedAt,
    });
  }

  if (isTerminalOrchestratorState(output.state)) {
    return buildTerminalRuntimeState(output.state, updatedAt);
  }

  const hasRunningBlocks = output.blocked_work_items.some((item) => {
    return item.category === "task-running" || item.category === "working";
  });
  const hasGeminiReady = output.next_actions.some(
    (item) => item.kind === "gemini-plan" || item.kind === "gemini-code",
  );
  const hasCodexReady = output.next_actions.some(
    (item) => item.kind === "codex-work",
  );

  if (hasRunningBlocks || hasGeminiReady) {
    return persistedOrchestratorRuntimeStateSchema.parse({
      status: "running",
      active: true,
      updated_at: updatedAt,
      last_tick_at: updatedAt,
    });
  }

  if (hasCodexReady) {
    return persistedOrchestratorRuntimeStateSchema.parse({
      status: "waiting_for_codex",
      active: false,
      updated_at: updatedAt,
      last_tick_at: updatedAt,
    });
  }

  return persistedOrchestratorRuntimeStateSchema.parse({
    status: "idle",
    active: false,
    updated_at: updatedAt,
    last_tick_at: updatedAt,
  });
}

export function buildLoopRuntimeState(
  output: Pick<
    RunOrchestratorLoopOutput,
    | "state"
    | "submitted_tasks"
    | "codex_actions"
    | "blocked_work_items"
    | "summary"
  >,
  updatedAt: string,
): PersistedOrchestratorRuntimeState {
  if (output.summary.status === "invalid-graph") {
    return persistedOrchestratorRuntimeStateSchema.parse({
      status: "invalid-graph",
      active: false,
      updated_at: updatedAt,
      last_tick_at: updatedAt,
    });
  }

  if (isTerminalOrchestratorState(output.state)) {
    return buildTerminalRuntimeState(output.state, updatedAt);
  }

  const hasRunningBlocks = output.blocked_work_items.some((item) => {
    return item.category === "task-running" || item.category === "working";
  });
  const hasSubmittedTasks = output.submitted_tasks.length > 0;
  const readyNonCodex = output.summary.ready_work_item_ids.some(
    (workItemId) => {
      return !output.codex_actions.some(
        (item) => item.work_item_id === workItemId,
      );
    },
  );

  if (hasRunningBlocks || hasSubmittedTasks || readyNonCodex) {
    return persistedOrchestratorRuntimeStateSchema.parse({
      status: "running",
      active: true,
      updated_at: updatedAt,
      last_tick_at: updatedAt,
    });
  }

  if (output.codex_actions.length > 0) {
    return persistedOrchestratorRuntimeStateSchema.parse({
      status: "waiting_for_codex",
      active: false,
      updated_at: updatedAt,
      last_tick_at: updatedAt,
    });
  }

  return persistedOrchestratorRuntimeStateSchema.parse({
    status: "idle",
    active: false,
    updated_at: updatedAt,
    last_tick_at: updatedAt,
  });
}

export function buildGraphOutput(input: {
  orchestrator_id?: string;
  persisted: boolean;
  loaded_from_store: boolean;
  persistence_warning?: string;
  updated_at: string;
  state: OrchestratorState;
  next_actions: OrchestratorNextAction[];
  blocked_work_items: BlockedWorkItem[];
  graph_validation_issues: ExecutionGraphIssue[];
  summary: OrchestratorRuntimeSummary;
}): RunOrchestratorGraphOutput {
  return runOrchestratorGraphOutputSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    orchestrator_id: input.orchestrator_id,
    persisted: input.persisted,
    loaded_from_store: input.loaded_from_store,
    persistence_warning: input.persistence_warning,
    updated_at: input.updated_at,
    state: input.state,
    next_actions: input.next_actions,
    completed_work_items: input.state.work_items
      .filter((item) => item.status === "completed")
      .map((item) => item.id),
    blocked_work_items: input.blocked_work_items,
    graph_validation_issues: input.graph_validation_issues,
    summary: input.summary,
  });
}

export function buildLoopOutput(input: {
  orchestrator_id?: string;
  persisted: boolean;
  loaded_from_store: boolean;
  persistence_warning?: string;
  updated_at: string;
  state: OrchestratorState;
  submitted_tasks: SubmittedTask[];
  codex_actions: CodexWorkAction[];
  blocked_work_items: BlockedWorkItem[];
  graph_validation_issues: ExecutionGraphIssue[];
  summary: OrchestratorRuntimeSummary;
}): RunOrchestratorLoopOutput {
  return runOrchestratorLoopOutputSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    orchestrator_id: input.orchestrator_id,
    persisted: input.persisted,
    loaded_from_store: input.loaded_from_store,
    persistence_warning: input.persistence_warning,
    updated_at: input.updated_at,
    state: input.state,
    submitted_tasks: input.submitted_tasks,
    codex_actions: input.codex_actions,
    blocked_work_items: input.blocked_work_items,
    graph_validation_issues: input.graph_validation_issues,
    summary: input.summary,
  });
}

export function isCodexAction(
  action: OrchestratorNextAction,
): action is CodexWorkAction {
  return action.kind === "codex-work";
}

export function isGeminiAction(
  action: OrchestratorNextAction,
): action is GeminiPlanAction | GeminiCodeAction {
  return action.kind === "gemini-plan" || action.kind === "gemini-code";
}
