import { appendOrchestratorEvent } from "./orchestrator-summary.js";
import type { PersistedOrchestratorRuntimeState } from "./orchestrator-runtime.js";
import type { OrchestratorSnapshot } from "./sqlite-persistence.js";
import {
  describeFailureError,
  ensureManualAction,
  findWorkItemFailureError,
  resetWorkItemForRetry,
  updateRetryState,
} from "./orchestrator-runtime-manager-helpers.js";

export interface ApplyFailurePolicyResult {
  snapshot: OrchestratorSnapshot;
  runtime: PersistedOrchestratorRuntimeState;
}

export interface ApplyFailurePolicyParams {
  snapshot: OrchestratorSnapshot;
  updatedAt: string;
  maxGeminiRetries: number;
}

export function applyFailurePolicy(
  params: ApplyFailurePolicyParams,
): ApplyFailurePolicyResult {
  const { snapshot, updatedAt, maxGeminiRetries } = params;

  let nextSnapshot = snapshot;
  let runtime: PersistedOrchestratorRuntimeState = {
    ...(snapshot.runtime ?? {
      status: "idle",
      active: false,
      updated_at: updatedAt,
    }),
  };

  let manualActions = [...(runtime.manual_actions ?? [])];
  let retryStates = [...(runtime.work_item_retry_state ?? [])];
  let mutatedState = snapshot.state;
  let requiresManualReview = false;
  let scheduledRetry = false;

  for (const workItem of snapshot.state.work_items.filter(
    (item) => item.status === "failed",
  )) {
    const binding = snapshot.state.task_bindings.find(
      (item) => item.work_item_id === workItem.id,
    );
    const failureError = findWorkItemFailureError(snapshot, workItem.id);
    const failureDetail = failureError
      ? describeFailureError(failureError)
      : undefined;
    const failureReason = binding
      ? failureDetail
        ? `Task '${binding.task_id}' failed for work item '${workItem.id}': ${failureDetail}`
        : `Task '${binding.task_id}' failed for work item '${workItem.id}'.`
      : failureDetail
        ? `Work item '${workItem.id}' failed: ${failureDetail}`
        : `Work item '${workItem.id}' failed without an active task binding.`;

    const existingRetry = retryStates.find(
      (item) => item.work_item_id === workItem.id,
    );
    const attempts = (existingRetry?.attempts ?? 0) + 1;
    retryStates = updateRetryState(
      retryStates,
      workItem.id,
      attempts,
      updatedAt,
      failureReason,
    );

    const isRetryableGemini =
      workItem.owner === "gemini" &&
      (workItem.type === "frontend-plan" || workItem.type === "frontend-code");

    if (isRetryableGemini && attempts <= maxGeminiRetries) {
      mutatedState = resetWorkItemForRetry(
        { ...nextSnapshot, state: mutatedState },
        workItem.id,
      ).state;
      scheduledRetry = true;
      nextSnapshot = {
        ...nextSnapshot,
        events: appendOrchestratorEvent(nextSnapshot.events, {
          level: "warn",
          event_type: "retry-scheduled",
          work_item_id: workItem.id,
          ts: updatedAt,
          message: `Retry ${attempts}/${maxGeminiRetries} scheduled for work item '${workItem.id}'.`,
          data: {
            attempts,
            max_attempts: maxGeminiRetries,
            ...(failureError
              ? {
                  error_kind: failureError.kind,
                  error_retryable: failureError.retryable,
                }
              : {}),
          },
        }),
      };
      continue;
    }

    requiresManualReview = true;
    manualActions = ensureManualAction(manualActions, {
      work_item_id: workItem.id,
      owner: workItem.owner,
      reason: failureReason,
      suggested_action: isRetryableGemini
        ? "Inspect the failed frontend task output and decide whether to retry manually or complete the work in Codex."
        : "Inspect the failed work item and decide whether to retry manually or provide a Codex-side result.",
      created_at: updatedAt,
    });
    nextSnapshot = {
      ...nextSnapshot,
      events: appendOrchestratorEvent(nextSnapshot.events, {
        level: "error",
        event_type: "manual-review-required",
        work_item_id: workItem.id,
        ts: updatedAt,
        message: `Work item '${workItem.id}' now requires manual review.`,
        data: {
          attempts,
          max_attempts: maxGeminiRetries,
          ...(failureError
            ? {
                error_kind: failureError.kind,
                error_retryable: failureError.retryable,
              }
            : {}),
        },
      }),
    };
  }

  runtime = {
    ...runtime,
    updated_at: updatedAt,
    last_tick_at: updatedAt,
    work_item_retry_state: retryStates,
    manual_actions: manualActions,
  };

  if (scheduledRetry) {
    runtime.status = "queued";
    runtime.active = true;
  } else if (requiresManualReview) {
    runtime.status = "manual-review-required";
    runtime.active = false;
  }

  return {
    snapshot: {
      ...nextSnapshot,
      state: mutatedState,
      runtime,
      updated_at: updatedAt,
    },
    runtime,
  };
}
