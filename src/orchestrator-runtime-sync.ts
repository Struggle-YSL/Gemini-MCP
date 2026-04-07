import type { TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ORCHESTRATOR_SCHEMA_VERSION } from "./orchestrator-contracts.js";
import {
  bindFrontendThread,
  createOrchestratorState,
  getBoundTaskForWorkItem,
  orchestratorStateSchema,
  setWorkItemResult,
  transitionWorkItemStatus,
  type ExecutionGraph,
  type OrchestratorState,
  type WorkItem,
} from "./orchestrator-state.js";
import {
  taskResultSnapshotSchema,
  workItemRuntimeInputSchema,
  type SessionBindingInput,
  type TaskResultSnapshot,
  type WorkItemRuntimeInput,
} from "./orchestrator-runtime-schemas.js";

function readStructuredContent(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const structuredContent = (result as Partial<CallToolResult>).structuredContent;
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    return undefined;
  }

  return structuredContent as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function loadTaskSnapshotFromStore(
  taskStore: TaskStore,
  taskId: string,
): Promise<TaskResultSnapshot | null> {
  const task = await taskStore.getTask(taskId);
  if (!task) {
    return null;
  }

  let result: unknown;
  if (task.status === "completed" || task.status === "failed") {
    try {
      result = await taskStore.getTaskResult(taskId);
    } catch {
      result = undefined;
    }
  }

  const structuredContent = readStructuredContent(result);
  return taskResultSnapshotSchema.parse({
    task_id: taskId,
    status: task.status,
    result,
    session_id: readOptionalString(structuredContent?.session_id),
    thread_id: readOptionalString(structuredContent?.thread_id),
    updated_at: task.lastUpdatedAt,
  });
}

export async function resolveTaskSnapshots(
  state: OrchestratorState,
  explicitSnapshots: TaskResultSnapshot[] | undefined,
  taskStore: TaskStore | undefined,
  autoLoadFromStore: boolean,
): Promise<TaskResultSnapshot[]> {
  const snapshots = new Map((explicitSnapshots ?? []).map((item) => [item.task_id, item]));
  if (!autoLoadFromStore || !taskStore) {
    return [...snapshots.values()];
  }

  for (const binding of state.task_bindings) {
    if (snapshots.has(binding.task_id)) {
      continue;
    }

    const snapshot = await loadTaskSnapshotFromStore(taskStore, binding.task_id);
    if (snapshot) {
      snapshots.set(binding.task_id, snapshot);
    }
  }

  return [...snapshots.values()];
}

export function syncStateWithGraph(
  graph: ExecutionGraph,
  state?: OrchestratorState,
): OrchestratorState {
  const baseState = state ?? createOrchestratorState(graph);
  const nextWorkItems = graph.work_items.map((graphWorkItem) => {
    const existing = baseState.work_items.find((item) => item.id === graphWorkItem.id);
    return {
      ...graphWorkItem,
      status: existing?.status ?? graphWorkItem.status,
      input:
        existing && Object.keys(existing.input).length > 0
          ? existing.input
          : graphWorkItem.input,
      acceptance:
        existing && existing.acceptance.length > 0
          ? existing.acceptance
          : graphWorkItem.acceptance,
    };
  });

  return orchestratorStateSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    work_items: nextWorkItems,
    task_bindings: baseState.task_bindings.filter((binding) => {
      return nextWorkItems.some((item) => item.id === binding.work_item_id);
    }),
    frontend_threads: baseState.frontend_threads.map((binding) => ({
      ...binding,
      work_item_ids: binding.work_item_ids.filter((workItemId) => {
        return nextWorkItems.some((item) => item.id === workItemId);
      }),
    })).filter((binding) => binding.work_item_ids.length > 0),
    work_item_results: baseState.work_item_results.filter((result) => {
      return nextWorkItems.some((item) => item.id === result.work_item_id);
    }),
  });
}

export function getRuntimeInput(
  workItem: WorkItem,
  overrides?: Record<string, WorkItemRuntimeInput>,
): WorkItemRuntimeInput {
  const fromState = workItemRuntimeInputSchema.partial().safeParse(workItem.input);
  const merged = {
    ...(fromState.success ? fromState.data : {}),
    ...(overrides?.[workItem.id] ?? {}),
  };

  if (!merged.acceptance_criteria?.length && workItem.acceptance.length > 0) {
    merged.acceptance_criteria = [...workItem.acceptance];
  }

  return merged;
}

export function findReusableSessionId(
  state: OrchestratorState,
  workItemId: string,
  preferredSessionId?: string,
): string | undefined {
  if (preferredSessionId) {
    return preferredSessionId;
  }

  const direct = state.frontend_threads.find((binding) => {
    return binding.work_item_ids.includes(workItemId);
  });
  if (direct) {
    return direct.session_id;
  }

  if (state.frontend_threads.length === 1) {
    return state.frontend_threads[0].session_id;
  }

  return undefined;
}

export function setStatusIfNeeded(
  state: OrchestratorState,
  workItemId: string,
  nextStatus: "working" | "completed" | "failed",
): OrchestratorState {
  const workItem = state.work_items.find((item) => item.id === workItemId);
  if (!workItem || workItem.status === nextStatus) {
    return state;
  }

  if (workItem.status === "completed" || workItem.status === "failed") {
    return state;
  }

  return transitionWorkItemStatus(state, workItemId, nextStatus);
}

export function applySessionBindings(
  state: OrchestratorState,
  bindings?: SessionBindingInput[],
): OrchestratorState {
  let nextState = state;
  for (const binding of bindings ?? []) {
    nextState = bindFrontendThread(nextState, {
      ...binding,
      updated_at: binding.updated_at ?? new Date().toISOString(),
    });
  }
  return nextState;
}

export function applyTaskSnapshots(
  state: OrchestratorState,
  taskResults?: TaskResultSnapshot[],
): OrchestratorState {
  let nextState = state;
  const snapshots = new Map((taskResults ?? []).map((item) => [item.task_id, item]));

  for (const binding of state.task_bindings) {
    const snapshot = snapshots.get(binding.task_id);
    if (!snapshot) {
      continue;
    }

    if (snapshot.session_id) {
      nextState = bindFrontendThread(nextState, {
        session_id: snapshot.session_id,
        thread_id: snapshot.thread_id ?? snapshot.session_id,
        work_item_ids: [binding.work_item_id],
        updated_at: snapshot.updated_at ?? new Date().toISOString(),
      });
    }

    if (snapshot.status === "queued" || snapshot.status === "working") {
      nextState = setStatusIfNeeded(nextState, binding.work_item_id, "working");
      continue;
    }

    if (snapshot.result !== undefined) {
      nextState = setWorkItemResult(
        nextState,
        binding.work_item_id,
        snapshot.result,
        snapshot.updated_at ?? new Date().toISOString(),
      );
    }

    if (snapshot.status === "completed") {
      nextState = setStatusIfNeeded(nextState, binding.work_item_id, "completed");
      continue;
    }

    nextState = setStatusIfNeeded(nextState, binding.work_item_id, "failed");
  }

  return nextState;
}

export function applyStoredResults(state: OrchestratorState): OrchestratorState {
  let nextState = state;

  for (const result of state.work_item_results) {
    const workItem = nextState.work_items.find((item) => item.id === result.work_item_id);
    if (!workItem) {
      continue;
    }

    if (workItem.status === "queued" || workItem.status === "working") {
      nextState = setStatusIfNeeded(nextState, workItem.id, "completed");
    }
  }

  return nextState;
}

export function getBoundTaskIdForWorkItem(state: OrchestratorState, workItemId: string): string | undefined {
  return getBoundTaskForWorkItem(state, workItemId)?.task_id;
}