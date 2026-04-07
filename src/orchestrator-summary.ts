import { randomUUID } from "node:crypto";
import { z } from "zod";
import { extractTaskFailureError } from "./error-model.js";
import type {
  ExecutionGraph,
  OrchestratorState,
  WorkItem,
} from "./orchestrator-state.js";
import type {
  OrchestratorRuntimeSummary,
  PersistedOrchestratorRuntimeState,
} from "./orchestrator-runtime.js";

export const orchestratorEventSchema = z.object({
  event_id: z.string(),
  ts: z.string(),
  level: z.enum(["info", "warn", "error"]),
  event_type: z.enum([
    "run-recovered",
    "task-submitted",
    "work-item-completed",
    "work-item-failed",
    "retry-scheduled",
    "manual-review-required",
    "run-completed",
    "run-failed",
  ]),
  work_item_id: z.string().optional(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const orchestratorRetryStateSchema = z.object({
  work_item_id: z.string(),
  attempts: z.number().int().min(0),
  last_error: z.string().optional(),
  last_failed_at: z.string().optional(),
});

export const orchestratorManualActionSchema = z.object({
  work_item_id: z.string(),
  owner: z.enum(["codex", "gemini"]),
  reason: z.string(),
  suggested_action: z.string(),
  created_at: z.string(),
});

const summaryWorkItemSchema = z.object({
  work_item_id: z.string(),
  owner: z.enum(["codex", "gemini"]),
  type: z.enum(["backend", "frontend-plan", "frontend-code", "integration"]),
  scope: z.string(),
  status: z.enum(["queued", "working", "completed", "failed"]),
  retry_attempts: z.number().int().min(0),
});

export const orchestratorWorkItemTimelineSchema = z.object({
  work_item_id: z.string(),
  owner: z.enum(["codex", "gemini"]),
  type: z.enum(["backend", "frontend-plan", "frontend-code", "integration"]),
  scope: z.string(),
  status: z.enum(["queued", "working", "completed", "failed"]),
  events: z.array(orchestratorEventSchema),
});

export const orchestratorFailureDiagnosticsSchema = z.object({
  total_failed_work_items: z.number().int().min(0),
  structured_failures: z.number().int().min(0),
  retryable_failures: z.number().int().min(0),
  non_retryable_failures: z.number().int().min(0),
  failure_kinds: z.record(z.string(), z.number().int().min(0)),
});

export const orchestratorFinalSummarySchema = z.object({
  status: z.enum([
    "running",
    "completed",
    "failed",
    "manual-review-required",
    "invalid-graph",
  ]),
  headline: z.string(),
  natural_language_summary: z.string(),
  completed_work_items: z.array(summaryWorkItemSchema),
  failed_work_items: z.array(summaryWorkItemSchema),
  pending_manual_actions: z.array(orchestratorManualActionSchema),
  work_item_timelines: z.array(orchestratorWorkItemTimelineSchema),
  failure_diagnostics: orchestratorFailureDiagnosticsSchema,
  updated_at: z.string(),
});

export type OrchestratorEvent = z.infer<typeof orchestratorEventSchema>;
export type OrchestratorRetryState = z.infer<
  typeof orchestratorRetryStateSchema
>;
export type OrchestratorManualAction = z.infer<
  typeof orchestratorManualActionSchema
>;
export type OrchestratorFailureDiagnostics = z.infer<
  typeof orchestratorFailureDiagnosticsSchema
>;
export type OrchestratorFinalSummary = z.infer<
  typeof orchestratorFinalSummarySchema
>;

export interface OrchestratorSummarySnapshotLike {
  orchestrator_id: string;
  graph: ExecutionGraph;
  state: OrchestratorState;
  summary: OrchestratorRuntimeSummary;
  runtime?: PersistedOrchestratorRuntimeState;
  events?: OrchestratorEvent[];
}

export interface CreateOrchestratorEventInput {
  level: OrchestratorEvent["level"];
  event_type: OrchestratorEvent["event_type"];
  message: string;
  ts?: string;
  work_item_id?: string;
  data?: Record<string, unknown>;
}

function toSummaryWorkItem(workItem: WorkItem, retryAttempts: number) {
  return {
    work_item_id: workItem.id,
    owner: workItem.owner,
    type: workItem.type,
    scope: workItem.scope,
    status: workItem.status,
    retry_attempts: retryAttempts,
  };
}

function buildFailureDiagnostics(
  snapshot: OrchestratorSummarySnapshotLike,
): OrchestratorFailureDiagnostics {
  const failedWorkItems = snapshot.state.work_items.filter(
    (item) => item.status === "failed",
  );
  const resultByWorkItemId = new Map(
    snapshot.state.work_item_results.map((result) => [
      result.work_item_id,
      result,
    ]),
  );

  let structuredFailures = 0;
  let retryableFailures = 0;
  let nonRetryableFailures = 0;
  const failureKinds: Record<string, number> = {};

  for (const workItem of failedWorkItems) {
    const result = resultByWorkItemId.get(workItem.id);
    const failureError = result
      ? extractTaskFailureError(result.payload)
      : undefined;

    if (!failureError) {
      failureKinds.unknown = (failureKinds.unknown ?? 0) + 1;
      nonRetryableFailures += 1;
      continue;
    }

    structuredFailures += 1;
    failureKinds[failureError.kind] =
      (failureKinds[failureError.kind] ?? 0) + 1;
    if (failureError.retryable) {
      retryableFailures += 1;
    } else {
      nonRetryableFailures += 1;
    }
  }

  return orchestratorFailureDiagnosticsSchema.parse({
    total_failed_work_items: failedWorkItems.length,
    structured_failures: structuredFailures,
    retryable_failures: retryableFailures,
    non_retryable_failures: nonRetryableFailures,
    failure_kinds: failureKinds,
  });
}

export function createOrchestratorEvent(
  input: CreateOrchestratorEventInput,
): OrchestratorEvent {
  return orchestratorEventSchema.parse({
    event_id: randomUUID(),
    ts: input.ts ?? new Date().toISOString(),
    level: input.level,
    event_type: input.event_type,
    work_item_id: input.work_item_id,
    message: input.message,
    data: input.data,
  });
}

export function appendOrchestratorEvent(
  events: OrchestratorEvent[] | undefined,
  event: CreateOrchestratorEventInput,
): OrchestratorEvent[] {
  return [...(events ?? []), createOrchestratorEvent(event)];
}

export function buildOrchestratorFinalSummary(
  snapshot: OrchestratorSummarySnapshotLike,
  updatedAt: string = new Date().toISOString(),
): OrchestratorFinalSummary {
  const retryState = new Map(
    (snapshot.runtime?.work_item_retry_state ?? []).map((item) => [
      item.work_item_id,
      item,
    ]),
  );
  const manualActions = snapshot.runtime?.manual_actions ?? [];
  const completedWorkItems = snapshot.state.work_items
    .filter((item) => item.status === "completed")
    .map((item) =>
      toSummaryWorkItem(item, retryState.get(item.id)?.attempts ?? 0),
    );
  const failedWorkItems = snapshot.state.work_items
    .filter((item) => item.status === "failed")
    .map((item) =>
      toSummaryWorkItem(item, retryState.get(item.id)?.attempts ?? 0),
    );
  const timelines = snapshot.state.work_items.map((item) => ({
    work_item_id: item.id,
    owner: item.owner,
    type: item.type,
    scope: item.scope,
    status: item.status,
    events: (snapshot.events ?? []).filter(
      (event) => event.work_item_id === item.id,
    ),
  }));

  let status: OrchestratorFinalSummary["status"];
  if (
    snapshot.summary.status === "invalid-graph" ||
    snapshot.runtime?.status === "invalid-graph"
  ) {
    status = "invalid-graph";
  } else if (
    manualActions.length > 0 ||
    snapshot.runtime?.status === "manual-review-required"
  ) {
    status = "manual-review-required";
  } else if (
    snapshot.state.work_items.every((item) => item.status === "completed")
  ) {
    status = "completed";
  } else if (
    snapshot.state.work_items.some((item) => item.status === "failed")
  ) {
    status = "failed";
  } else {
    status = "running";
  }

  const headline =
    status === "completed"
      ? `Run ${snapshot.orchestrator_id} completed successfully.`
      : status === "manual-review-required"
        ? `Run ${snapshot.orchestrator_id} requires manual review.`
        : status === "failed"
          ? `Run ${snapshot.orchestrator_id} failed.`
          : status === "invalid-graph"
            ? `Run ${snapshot.orchestrator_id} is blocked by an invalid graph.`
            : `Run ${snapshot.orchestrator_id} is still in progress.`;

  const naturalLanguageSummary = [
    headline,
    `${completedWorkItems.length} work item(s) completed, ${failedWorkItems.length} failed, ${manualActions.length} waiting for manual action.`,
    snapshot.summary.message,
  ].join(" ");

  return orchestratorFinalSummarySchema.parse({
    status,
    headline,
    natural_language_summary: naturalLanguageSummary,
    completed_work_items: completedWorkItems,
    failed_work_items: failedWorkItems,
    pending_manual_actions: manualActions,
    work_item_timelines: timelines,
    failure_diagnostics: buildFailureDiagnostics(snapshot),
    updated_at: updatedAt,
  });
}
