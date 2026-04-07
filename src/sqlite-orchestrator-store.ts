import type {
  DatabaseSync,
  OrchestratorRow,
  OrchestratorSnapshot,
  OrchestratorStore,
  PersistOrchestratorSnapshotInput,
} from "./sqlite-persistence-types.js";
import {
  isRecoverableOrchestratorSnapshot,
  mergePersistedSnapshotFields,
  ORCHESTRATOR_SELECT_COLUMNS,
  parseOrchestratorRow,
} from "./sqlite-orchestrator-store-helpers.js";

export class SQLiteOrchestratorStore implements OrchestratorStore {
  constructor(private readonly db: DatabaseSync) {}

  saveOrchestratorSnapshot(input: PersistOrchestratorSnapshotInput): void {
    const existing = this.loadOrchestratorSnapshot(input.orchestratorId);
    const {
      updatedAt,
      mergedContext,
      mergedRuntime,
      mergedEvents,
      mergedFinalSummary,
    } = mergePersistedSnapshotFields(input, existing);

    this.db
      .prepare(
        `
      INSERT INTO orchestrator_snapshots (
        orchestrator_id,
        graph_json,
        state_json,
        summary_json,
        context_json,
        runtime_json,
        events_json,
        final_summary_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(orchestrator_id) DO UPDATE SET
        graph_json = excluded.graph_json,
        state_json = excluded.state_json,
        summary_json = excluded.summary_json,
        context_json = excluded.context_json,
        runtime_json = excluded.runtime_json,
        events_json = excluded.events_json,
        final_summary_json = excluded.final_summary_json,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        input.orchestratorId,
        JSON.stringify(input.graph),
        JSON.stringify(input.state),
        JSON.stringify(input.summary),
        mergedContext ? JSON.stringify(mergedContext) : null,
        mergedRuntime ? JSON.stringify(mergedRuntime) : null,
        mergedEvents ? JSON.stringify(mergedEvents) : null,
        mergedFinalSummary ? JSON.stringify(mergedFinalSummary) : null,
        updatedAt,
      );
  }

  loadOrchestratorSnapshot(
    orchestratorId: string,
  ): OrchestratorSnapshot | null {
    const row = this.db
      .prepare(
        `
      SELECT ${ORCHESTRATOR_SELECT_COLUMNS}
      FROM orchestrator_snapshots
      WHERE orchestrator_id = ?
    `,
      )
      .get(orchestratorId) as OrchestratorRow | undefined;

    return row ? parseOrchestratorRow(row) : null;
  }

  listOrchestratorRuns(limit: number = 20): OrchestratorSnapshot[] {
    const rows = this.db
      .prepare(
        `
      SELECT ${ORCHESTRATOR_SELECT_COLUMNS}
      FROM orchestrator_snapshots
      ORDER BY updated_at DESC
      LIMIT ?
    `,
      )
      .all(limit) as OrchestratorRow[];

    return rows.map(parseOrchestratorRow);
  }

  listRecoverableOrchestratorRuns(limit: number = 100): OrchestratorSnapshot[] {
    return this.listOrchestratorRuns(limit).filter(
      isRecoverableOrchestratorSnapshot,
    );
  }
}
