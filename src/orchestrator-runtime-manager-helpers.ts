import { extractTaskFailureError, type StructuredError } from "./error-model.js";
import {
  appendOrchestratorEvent,
  buildOrchestratorFinalSummary,
  type OrchestratorEvent,
  type OrchestratorManualAction,
  type OrchestratorRetryState,
} from "./orchestrator-summary.js";
import type { PersistedOrchestratorRuntimeState } from "./orchestrator-runtime.js";
import type { OrchestratorSnapshot, OrchestratorStore } from "./sqlite-persistence.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createQueuedRuntimeState(
  updatedAt: string,
  previous?: PersistedOrchestratorRuntimeState,
): PersistedOrchestratorRuntimeState {
  return {
    status: "queued",
    active: true,
    updated_at: updatedAt,
    last_tick_at: updatedAt,
    work_item_retry_state: previous?.work_item_retry_state,
    manual_actions: previous?.manual_actions,
  };
}

export function createFailedRecoveryState(
  error: unknown,
  updatedAt: string,
  previous?: PersistedOrchestratorRuntimeState,
): PersistedOrchestratorRuntimeState {
  return {
    status: "failed-recovery",
    active: false,
    updated_at: updatedAt,
    last_tick_at: updatedAt,
    last_error: String(error),
    work_item_retry_state: previous?.work_item_retry_state,
    manual_actions: previous?.manual_actions,
  };
}

export function isTerminalRuntimeStatus(status: PersistedOrchestratorRuntimeState["status"]): boolean {
  return (
    status === "completed"
    || status === "failed"
    || status === "invalid-graph"
    || status === "failed-recovery"
    || status === "manual-review-required"
  );
}

export function shouldKeepActive(snapshot: OrchestratorSnapshot): boolean {
  return snapshot.runtime?.active === true && snapshot.runtime.status !== "manual-review-required";
}

export function updateRetryState(
  retryStates: OrchestratorRetryState[],
  workItemId: string,
  attempts: number,
  failedAt: string,
  lastError: string,
): OrchestratorRetryState[] {
  const next = retryStates.filter((item) => item.work_item_id !== workItemId);
  next.push({
    work_item_id: workItemId,
    attempts,
    last_failed_at: failedAt,
    last_error: lastError,
  });
  return next;
}

export function ensureManualAction(
  manualActions: OrchestratorManualAction[],
  action: OrchestratorManualAction,
): OrchestratorManualAction[] {
  if (manualActions.some((item) => item.work_item_id === action.work_item_id)) {
    return manualActions;
  }
  return [...manualActions, action];
}

export function describeFailureError(error: StructuredError): string {
  return `${error.message} [kind=${error.kind}, retryable=${error.retryable}]`;
}

export function findWorkItemFailureError(snapshot: OrchestratorSnapshot, workItemId: string): StructuredError | undefined {
  const workItemResult = snapshot.state.work_item_results.find((item) => item.work_item_id === workItemId);
  if (!workItemResult) {
    return undefined;
  }

  return extractTaskFailureError(workItemResult.payload);
}

export function resetWorkItemForRetry(snapshot: OrchestratorSnapshot, workItemId: string): OrchestratorSnapshot {
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      work_items: snapshot.state.work_items.map((item) => {
        return item.id === workItemId ? { ...item, status: "queued" } : item;
      }),
      task_bindings: snapshot.state.task_bindings.filter((binding) => binding.work_item_id !== workItemId),
      work_item_results: snapshot.state.work_item_results.filter((result) => result.work_item_id !== workItemId),
    },
  };
}

export function appendMissingTaskEvents(snapshot: OrchestratorSnapshot): OrchestratorEvent[] {
  let events = snapshot.events ?? [];
  for (const binding of snapshot.state.task_bindings) {
    const alreadyRecorded = events.some((event) => {
      return event.event_type === "task-submitted" && event.data?.task_id === binding.task_id;
    });
    if (alreadyRecorded) {
      continue;
    }
    events = appendOrchestratorEvent(events, {
      level: "info",
      event_type: "task-submitted",
      work_item_id: binding.work_item_id,
      ts: binding.updated_at,
      message: `Submitted task '${binding.task_id}' for work item '${binding.work_item_id}'.`,
      data: {
        task_id: binding.task_id,
        tool_name: binding.tool_name,
        session_id: binding.session_id,
      },
    });
  }
  return events;
}

export function persistSnapshot(
  store: OrchestratorStore,
  snapshot: OrchestratorSnapshot,
): OrchestratorSnapshot {
  const updatedAt = snapshot.updated_at ?? nowIso();
  const finalSummary = buildOrchestratorFinalSummary(snapshot, updatedAt);
  store.saveOrchestratorSnapshot({
    orchestratorId: snapshot.orchestrator_id,
    graph: snapshot.graph,
    state: snapshot.state,
    summary: snapshot.summary,
    context: snapshot.context,
    runtime: snapshot.runtime,
    events: snapshot.events,
    finalSummary,
    updatedAt,
  });
  return store.loadOrchestratorSnapshot(snapshot.orchestrator_id) ?? {
    ...snapshot,
    final_summary: finalSummary,
  };
}
