import { z } from "zod";
import { ORCHESTRATOR_SCHEMA_VERSION } from "./orchestrator-contracts.js";
import {
  buildOrchestratorFinalSummary,
  createOrchestratorEvent,
  orchestratorFinalSummarySchema,
  orchestratorManualActionSchema,
} from "./orchestrator-summary.js";
import {
  orchestratorStateSchema,
  setWorkItemResult,
  transitionWorkItemStatus,
  type OrchestratorState,
} from "./orchestrator-state.js";
import {
  orchestratorSnapshotSchema,
  persistedOrchestratorRuntimeStateSchema,
} from "./orchestrator-runtime.js";
import type { OrchestratorRuntimeManager } from "./orchestrator-runtime-manager.js";
import type { OrchestratorStore } from "./sqlite-persistence.js";

const recommendedActionSchema = z.object({
  work_item_id: z.string(),
  kind: z.enum(["provide-result", "retry-work-item", "mark-failed", "none"]),
  reason: z.string(),
});

const completedResultSchema = z.object({
  work_item_id: z.string(),
  payload: z.unknown(),
  updated_at: z.string(),
});

export const getOrchestratorResolutionInputSchema = z.object({
  orchestrator_id: z.string(),
});

export const getOrchestratorResolutionOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  orchestrator_id: z.string(),
  run_status: z.enum([
    "running",
    "completed",
    "failed",
    "manual-review-required",
    "invalid-graph",
  ]),
  ready_for_summary: z.boolean(),
  recommended_actions: z.array(recommendedActionSchema),
  manual_actions: z.array(orchestratorManualActionSchema),
  completed_results: z.array(completedResultSchema),
  natural_language_summary: z.string(),
  final_summary: orchestratorFinalSummarySchema,
});

const resolutionEntrySchema = z.union([
  z.object({
    kind: z.literal("provide-result"),
    work_item_id: z.string(),
    result: z.unknown(),
    mark_completed: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("retry-work-item"),
    work_item_id: z.string(),
  }),
  z.object({
    kind: z.literal("mark-failed"),
    work_item_id: z.string(),
    reason: z.string(),
  }),
]);

export const applyOrchestratorResolutionInputSchema = z.object({
  orchestrator_id: z.string(),
  resolutions: z.array(resolutionEntrySchema).min(1),
});

export const applyOrchestratorResolutionOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  orchestrator_id: z.string(),
  applied: z.array(
    z.object({
      work_item_id: z.string(),
      kind: z.enum(["provide-result", "retry-work-item", "mark-failed"]),
      status: z.literal("applied"),
    }),
  ),
  state: orchestratorStateSchema,
  runtime: persistedOrchestratorRuntimeStateSchema.optional(),
  final_summary: orchestratorFinalSummarySchema,
  reactivated_runtime: z.boolean(),
  updated_at: z.string(),
});

export type GetOrchestratorResolutionInput = z.infer<
  typeof getOrchestratorResolutionInputSchema
>;
export type GetOrchestratorResolutionOutput = z.infer<
  typeof getOrchestratorResolutionOutputSchema
>;
export type ApplyOrchestratorResolutionInput = z.infer<
  typeof applyOrchestratorResolutionInputSchema
>;
export type ApplyOrchestratorResolutionOutput = z.infer<
  typeof applyOrchestratorResolutionOutputSchema
>;

export interface OrchestratorResolutionOptions {
  orchestratorStore?: OrchestratorStore;
  runtimeManager?: Pick<OrchestratorRuntimeManager, "register">;
}

function requireSnapshot(
  orchestratorId: string,
  orchestratorStore?: OrchestratorStore,
) {
  if (!orchestratorStore) {
    throw new Error(
      "Orchestrator persistence is unavailable. SQLite orchestrator store is required.",
    );
  }

  const snapshot = orchestratorStore.loadOrchestratorSnapshot(orchestratorId);
  if (!snapshot) {
    throw new Error(`Orchestrator snapshot not found: ${orchestratorId}`);
  }

  return orchestratorSnapshotSchema.parse(snapshot);
}

function createRuntimeBase(updatedAt: string) {
  return {
    status: "idle" as const,
    active: false,
    updated_at: updatedAt,
    last_tick_at: updatedAt,
    manual_actions: [],
    work_item_retry_state: [],
  };
}

function resolveRunStatus(
  snapshot: ReturnType<typeof requireSnapshot>,
): GetOrchestratorResolutionOutput["run_status"] {
  return (
    snapshot.final_summary?.status ??
    buildOrchestratorFinalSummary(snapshot, snapshot.updated_at).status
  );
}

function buildRecommendedActions(snapshot: ReturnType<typeof requireSnapshot>) {
  const actions: GetOrchestratorResolutionOutput["recommended_actions"] = [];
  const manualActionMap = new Map(
    (snapshot.runtime?.manual_actions ?? []).map((item) => [
      item.work_item_id,
      item,
    ]),
  );

  for (const workItem of snapshot.state.work_items) {
    if (workItem.status === "completed") {
      actions.push({
        work_item_id: workItem.id,
        kind: "none",
        reason: `Work item '${workItem.id}' is already completed.`,
      });
      continue;
    }

    const manualAction = manualActionMap.get(workItem.id);
    if (manualAction) {
      actions.push({
        work_item_id: workItem.id,
        kind:
          workItem.owner === "gemini" ? "retry-work-item" : "provide-result",
        reason: manualAction.reason,
      });
      continue;
    }

    if (workItem.owner === "codex") {
      actions.push({
        work_item_id: workItem.id,
        kind: "provide-result",
        reason: `Codex-owned work item '${workItem.id}' can be completed by writing a result back into orchestrator state.`,
      });
      continue;
    }

    if (workItem.status === "failed") {
      actions.push({
        work_item_id: workItem.id,
        kind: workItem.owner === "gemini" ? "retry-work-item" : "mark-failed",
        reason: `Work item '${workItem.id}' is failed and requires explicit resolution.`,
      });
    }
  }

  return actions;
}

export function getOrchestratorResolution(
  rawInput: unknown,
  options: OrchestratorResolutionOptions = {},
): GetOrchestratorResolutionOutput {
  const input = getOrchestratorResolutionInputSchema.parse(rawInput);
  const snapshot = requireSnapshot(
    input.orchestrator_id,
    options.orchestratorStore,
  );
  const finalSummary =
    snapshot.final_summary ??
    buildOrchestratorFinalSummary(snapshot, snapshot.updated_at);

  return getOrchestratorResolutionOutputSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    orchestrator_id: snapshot.orchestrator_id,
    run_status: resolveRunStatus(snapshot),
    ready_for_summary: snapshot.state.work_items.every(
      (item) => item.status === "completed" || item.status === "failed",
    ),
    recommended_actions: buildRecommendedActions(snapshot),
    manual_actions: snapshot.runtime?.manual_actions ?? [],
    completed_results: snapshot.state.work_item_results,
    natural_language_summary: finalSummary.natural_language_summary,
    final_summary: finalSummary,
  });
}

function clearWorkItemBindings(
  state: OrchestratorState,
  workItemId: string,
): OrchestratorState {
  return orchestratorStateSchema.parse({
    ...state,
    task_bindings: state.task_bindings.filter(
      (binding) => binding.work_item_id !== workItemId,
    ),
    frontend_threads: state.frontend_threads
      .map((thread) => ({
        ...thread,
        work_item_ids: thread.work_item_ids.filter((id) => id !== workItemId),
      }))
      .filter((thread) => thread.work_item_ids.length > 0),
    work_item_results: state.work_item_results.filter(
      (result) => result.work_item_id !== workItemId,
    ),
  });
}

function updateRuntimeForRetry(
  snapshot: ReturnType<typeof requireSnapshot>,
  workItemId: string,
  updatedAt: string,
) {
  const runtime = snapshot.runtime
    ? { ...snapshot.runtime }
    : createRuntimeBase(updatedAt);

  runtime.status = "queued";
  runtime.active = true;
  runtime.updated_at = updatedAt;
  runtime.last_tick_at = updatedAt;
  runtime.manual_actions = (runtime.manual_actions ?? []).filter(
    (item) => item.work_item_id !== workItemId,
  );
  return persistedOrchestratorRuntimeStateSchema.parse(runtime);
}

function updateRuntimeForResolution(
  snapshot: ReturnType<typeof requireSnapshot>,
  updatedAt: string,
) {
  const runtime = snapshot.runtime
    ? { ...snapshot.runtime }
    : createRuntimeBase(updatedAt);

  const hasManualActions = (runtime.manual_actions ?? []).length > 0;
  const hasFailures = snapshot.state.work_items.some(
    (item) => item.status === "failed",
  );
  const allTerminal = snapshot.state.work_items.every(
    (item) => item.status === "completed" || item.status === "failed",
  );

  if (hasManualActions) {
    runtime.status = "manual-review-required";
    runtime.active = false;
  } else if (allTerminal) {
    runtime.status = hasFailures ? "failed" : "completed";
    runtime.active = false;
  } else {
    runtime.status = "queued";
    runtime.active = true;
  }

  runtime.updated_at = updatedAt;
  runtime.last_tick_at = updatedAt;
  return persistedOrchestratorRuntimeStateSchema.parse(runtime);
}

export function applyOrchestratorResolution(
  rawInput: unknown,
  options: OrchestratorResolutionOptions = {},
): ApplyOrchestratorResolutionOutput {
  const input = applyOrchestratorResolutionInputSchema.parse(rawInput);
  const snapshot = requireSnapshot(
    input.orchestrator_id,
    options.orchestratorStore,
  );
  const updatedAt = new Date().toISOString();
  let state = snapshot.state;
  let runtime = snapshot.runtime;
  let events = [...(snapshot.events ?? [])];
  const applied: ApplyOrchestratorResolutionOutput["applied"] = [];
  let reactivatedRuntime = false;

  for (const resolution of input.resolutions) {
    if (!state.work_items.some((item) => item.id === resolution.work_item_id)) {
      throw new Error(
        `Unknown work item '${resolution.work_item_id}' in orchestrator '${input.orchestrator_id}'.`,
      );
    }

    if (resolution.kind === "provide-result") {
      state = setWorkItemResult(
        state,
        resolution.work_item_id,
        resolution.result,
        updatedAt,
      );
      state = transitionWorkItemStatus(
        state,
        resolution.work_item_id,
        resolution.mark_completed === false ? "working" : "completed",
      );
      if (runtime?.manual_actions) {
        runtime = {
          ...runtime,
          manual_actions: runtime.manual_actions.filter(
            (item) => item.work_item_id !== resolution.work_item_id,
          ),
        };
      }
      events.push(
        createOrchestratorEvent({
          level: "info",
          event_type: "work-item-completed",
          work_item_id: resolution.work_item_id,
          ts: updatedAt,
          message: `Codex provided a result for work item '${resolution.work_item_id}'.`,
        }),
      );
    } else if (resolution.kind === "retry-work-item") {
      state = clearWorkItemBindings(state, resolution.work_item_id);
      state = orchestratorStateSchema.parse({
        ...state,
        work_items: state.work_items.map((item) => {
          return item.id === resolution.work_item_id
            ? { ...item, status: "queued" }
            : item;
        }),
      });
      runtime = updateRuntimeForRetry(
        { ...snapshot, state, runtime, events },
        resolution.work_item_id,
        updatedAt,
      );
      reactivatedRuntime = true;
      events.push(
        createOrchestratorEvent({
          level: "warn",
          event_type: "retry-scheduled",
          work_item_id: resolution.work_item_id,
          ts: updatedAt,
          message: `Manual retry scheduled for work item '${resolution.work_item_id}'.`,
        }),
      );
    } else {
      state = clearWorkItemBindings(state, resolution.work_item_id);
      state = transitionWorkItemStatus(
        state,
        resolution.work_item_id,
        "failed",
      );
      const nextManualActions = [
        ...(runtime?.manual_actions ?? []).filter(
          (item) => item.work_item_id !== resolution.work_item_id,
        ),
        {
          work_item_id: resolution.work_item_id,
          owner:
            state.work_items.find((item) => item.id === resolution.work_item_id)
              ?.owner ?? "codex",
          reason: resolution.reason,
          suggested_action: "Run marked failed by Codex resolution.",
          created_at: updatedAt,
        },
      ];
      runtime = persistedOrchestratorRuntimeStateSchema.parse({
        ...(runtime ?? createRuntimeBase(updatedAt)),
        status: "manual-review-required",
        active: false,
        updated_at: updatedAt,
        last_tick_at: updatedAt,
        manual_actions: nextManualActions,
      });
      events.push(
        createOrchestratorEvent({
          level: "error",
          event_type: "manual-review-required",
          work_item_id: resolution.work_item_id,
          ts: updatedAt,
          message: `Codex marked work item '${resolution.work_item_id}' as failed: ${resolution.reason}`,
        }),
      );
    }

    applied.push({
      work_item_id: resolution.work_item_id,
      kind: resolution.kind,
      status: "applied",
    });
  }

  const nextSnapshot = orchestratorSnapshotSchema.parse({
    ...snapshot,
    state,
    runtime: updateRuntimeForResolution(
      { ...snapshot, state, runtime, events },
      updatedAt,
    ),
    events,
    updated_at: updatedAt,
  });
  const finalSummary = buildOrchestratorFinalSummary(nextSnapshot, updatedAt);

  options.orchestratorStore?.saveOrchestratorSnapshot({
    orchestratorId: nextSnapshot.orchestrator_id,
    graph: nextSnapshot.graph,
    state: nextSnapshot.state,
    summary: nextSnapshot.summary,
    context: nextSnapshot.context,
    runtime: nextSnapshot.runtime,
    events: nextSnapshot.events,
    finalSummary,
    updatedAt,
  });

  if (reactivatedRuntime) {
    options.runtimeManager?.register(nextSnapshot.orchestrator_id);
  }

  return applyOrchestratorResolutionOutputSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    orchestrator_id: nextSnapshot.orchestrator_id,
    applied,
    state: nextSnapshot.state,
    runtime: nextSnapshot.runtime,
    final_summary: finalSummary,
    reactivated_runtime: reactivatedRuntime,
    updated_at: updatedAt,
  });
}
