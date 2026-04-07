import { log } from "./gemini-runner.js";
import { appendOrchestratorEvent } from "./orchestrator-summary.js";
import type {
  PersistedOrchestratorRuntimeState,
  RunOrchestratorLoopInput,
} from "./orchestrator-runtime.js";
import type { OrchestratorSnapshot, OrchestratorStore } from "./sqlite-persistence.js";
import {
  appendWorkItemStatusTransitionEvents,
  appendSubmittedTaskEvents,
} from "./orchestrator-runtime-manager-events.js";
import {
  appendMissingTaskEvents,
  createFailedRecoveryState,
  isTerminalRuntimeStatus,
  nowIso,
  persistSnapshot,
  shouldKeepActive,
} from "./orchestrator-runtime-manager-helpers.js";
import { applyFailurePolicy } from "./orchestrator-runtime-manager-retry.js";
import type {
  OrchestratorLoopRunner,
  OrchestratorRuntimeManagerOptions,
} from "./orchestrator-runtime-manager-types.js";

export interface ProcessManagedRunParams {
  orchestratorId: string;
  store: OrchestratorStore;
  runner: OrchestratorLoopRunner;
  taskStore: OrchestratorRuntimeManagerOptions["taskStore"];
  geminiTaskSubmitter: OrchestratorRuntimeManagerOptions["geminiTaskSubmitter"];
  maxGeminiRetries: number;
}

export type ProcessManagedRunResult =
  | { type: "drop-track" }
  | {
      type: "tracked";
      runtime: PersistedOrchestratorRuntimeState;
      requeue: boolean;
    };

function buildRunInput(
  orchestratorId: string,
  snapshot: OrchestratorSnapshot,
  context: NonNullable<OrchestratorSnapshot["context"]>,
): RunOrchestratorLoopInput {
  return {
    orchestrator_id: orchestratorId,
    persist: true,
    load_if_exists: false,
    auto_submit_gemini: true,
    max_submissions: 1,
    graph: snapshot.graph,
    state: snapshot.state,
    project_context: context.project_context,
    backend_contracts: context.backend_contracts,
    acceptance_criteria: context.acceptance_criteria,
    work_item_inputs: context.work_item_inputs,
  };
}

function buildRecoveryFailureSnapshot(
  orchestratorId: string,
  snapshot: OrchestratorSnapshot,
  error: unknown,
  updatedAt: string,
): OrchestratorSnapshot {
  const message = String(error);

  return {
    ...snapshot,
    runtime: createFailedRecoveryState(error, updatedAt, snapshot.runtime),
    updated_at: updatedAt,
    events: appendOrchestratorEvent(snapshot.events, {
      level: "error",
      event_type: "run-failed",
      ts: updatedAt,
      message: `Background orchestrator tick failed for '${orchestratorId}'.`,
      data: {
        error: message,
      },
    }),
  };
}

export async function processManagedRun(
  params: ProcessManagedRunParams,
): Promise<ProcessManagedRunResult> {
  const {
    orchestratorId,
    store,
    runner,
    taskStore,
    geminiTaskSubmitter,
    maxGeminiRetries,
  } = params;

  const snapshot = store.loadOrchestratorSnapshot(orchestratorId);
  if (!snapshot) {
    return { type: "drop-track" };
  }

  if (!snapshot.context) {
    const updatedAt = nowIso();
    const failedSnapshot = persistSnapshot(store, {
      ...snapshot,
      runtime: createFailedRecoveryState(
        "Persisted orchestrator snapshot is missing runtime context.",
        updatedAt,
        snapshot.runtime,
      ),
      updated_at: updatedAt,
      events: appendOrchestratorEvent(snapshot.events, {
        level: "error",
        event_type: "run-failed",
        ts: updatedAt,
        message: `Failed to recover orchestrator run '${orchestratorId}' because runtime context is missing.`,
      }),
    });

    const runtime = failedSnapshot.runtime as PersistedOrchestratorRuntimeState;
    log("warn", "Orchestrator run recovery skipped because context is missing", {
      orchestratorId,
    });
    return { type: "tracked", runtime, requeue: false };
  }

  const context = snapshot.context;

  try {
    const output = await runner.run(
      buildRunInput(orchestratorId, snapshot, context),
      {
        orchestratorStore: store,
        taskStore,
        geminiTaskSubmitter,
      },
    );

    const latest = store.loadOrchestratorSnapshot(orchestratorId);
    if (!latest?.runtime) {
      return { type: "drop-track" };
    }

    const previousStatus = new Map(snapshot.state.work_items.map((item) => [item.id, item.status]));
    const updatedAt = nowIso();

    let nextSnapshot: OrchestratorSnapshot = {
      ...latest,
      events: appendMissingTaskEvents(latest),
    };
    nextSnapshot = appendWorkItemStatusTransitionEvents(nextSnapshot, previousStatus, updatedAt);
    nextSnapshot = appendSubmittedTaskEvents(nextSnapshot, output.submitted_tasks, updatedAt);

    const reconciled = applyFailurePolicy({
      snapshot: nextSnapshot,
      updatedAt,
      maxGeminiRetries,
    });

    nextSnapshot = persistSnapshot(store, reconciled.snapshot);

    if (
      nextSnapshot.runtime?.status === "completed"
      && !(nextSnapshot.events ?? []).some((event) => event.event_type === "run-completed")
    ) {
      nextSnapshot = persistSnapshot(store, {
        ...nextSnapshot,
        events: appendOrchestratorEvent(nextSnapshot.events, {
          level: "info",
          event_type: "run-completed",
          ts: updatedAt,
          message: `Orchestrator run '${orchestratorId}' completed successfully.`,
        }),
        updated_at: updatedAt,
      });
    }

    const finalRuntime = nextSnapshot.runtime ?? createFailedRecoveryState(
      "Missing runtime state after orchestrator persistence.",
      updatedAt,
    );

    if (isTerminalRuntimeStatus(finalRuntime.status)) {
      log("info", "Orchestrator run reached terminal state", {
        orchestratorId,
        status: finalRuntime.status,
      });
    }

    return {
      type: "tracked",
      runtime: finalRuntime,
      requeue: shouldKeepActive({ ...nextSnapshot, runtime: finalRuntime }),
    };
  } catch (error) {
    const updatedAt = nowIso();
    const failedSnapshot = persistSnapshot(store, buildRecoveryFailureSnapshot(
      orchestratorId,
      snapshot,
      error,
      updatedAt,
    ));
    const runtime = failedSnapshot.runtime as PersistedOrchestratorRuntimeState;
    log("error", "Background orchestrator tick failed", {
      orchestratorId,
      error: String(error),
    });

    return { type: "tracked", runtime, requeue: false };
  }
}