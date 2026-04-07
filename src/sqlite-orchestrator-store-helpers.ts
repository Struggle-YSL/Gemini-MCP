import type {
  ExecutionGraph,
  OrchestratorState,
} from "./orchestrator-state.js";
import type {
  OrchestratorRuntimeSummary,
  PersistedOrchestratorContext,
  PersistedOrchestratorRuntimeState,
} from "./orchestrator-runtime.js";
import type {
  OrchestratorEvent,
  OrchestratorFinalSummary,
} from "./orchestrator-summary.js";
import { deserializeJson } from "./sqlite-persistence-db.js";
import type {
  OrchestratorRow,
  OrchestratorSnapshot,
  PersistOrchestratorSnapshotInput,
} from "./sqlite-persistence-types.js";

export const ORCHESTRATOR_SELECT_COLUMNS =
  "orchestrator_id, graph_json, state_json, summary_json, context_json, runtime_json, events_json, final_summary_json, updated_at";

export function parseOrchestratorRow(
  row: OrchestratorRow,
): OrchestratorSnapshot {
  return {
    orchestrator_id: row.orchestrator_id,
    graph: JSON.parse(row.graph_json) as ExecutionGraph,
    state: JSON.parse(row.state_json) as OrchestratorState,
    summary: JSON.parse(row.summary_json) as OrchestratorRuntimeSummary,
    context: deserializeJson<PersistedOrchestratorContext | undefined>(
      row.context_json,
      undefined,
    ),
    runtime: deserializeJson<PersistedOrchestratorRuntimeState | undefined>(
      row.runtime_json,
      undefined,
    ),
    events: deserializeJson<OrchestratorEvent[] | undefined>(
      row.events_json,
      undefined,
    ),
    final_summary: deserializeJson<OrchestratorFinalSummary | undefined>(
      row.final_summary_json,
      undefined,
    ),
    updated_at: row.updated_at,
  };
}

export function mergePersistedSnapshotFields(
  input: PersistOrchestratorSnapshotInput,
  existing: OrchestratorSnapshot | null,
): {
  updatedAt: string;
  mergedContext?: PersistedOrchestratorContext;
  mergedRuntime?: PersistedOrchestratorRuntimeState;
  mergedEvents?: OrchestratorEvent[];
  mergedFinalSummary?: OrchestratorFinalSummary;
} {
  return {
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    mergedContext: input.context ?? existing?.context,
    mergedRuntime: input.runtime
      ? { ...(existing?.runtime ?? {}), ...input.runtime }
      : existing?.runtime,
    mergedEvents: input.events ?? existing?.events,
    mergedFinalSummary: input.finalSummary ?? existing?.final_summary,
  };
}

function isTerminalOrchestratorSnapshot(
  snapshot: OrchestratorSnapshot,
): boolean {
  return snapshot.state.work_items.every(
    (item) => item.status === "completed" || item.status === "failed",
  );
}

export function isRecoverableOrchestratorSnapshot(
  snapshot: OrchestratorSnapshot,
): boolean {
  return (
    !isTerminalOrchestratorSnapshot(snapshot) &&
    snapshot.summary.status === "ok" &&
    snapshot.runtime?.status !== "invalid-graph" &&
    snapshot.runtime?.status !== "failed-recovery"
  );
}
