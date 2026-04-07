import type {
  TaskMessageQueue,
  TaskStore,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type { GeminiSessionStore } from "./session-store.js";
import type {
  OrchestratorRuntimeSummary,
  PersistedOrchestratorContext,
  PersistedOrchestratorRuntimeState,
} from "./orchestrator-runtime.js";
import type {
  OrchestratorEvent,
  OrchestratorFinalSummary,
} from "./orchestrator-summary.js";
import type {
  ExecutionGraph,
  OrchestratorState,
} from "./orchestrator-state.js";

export type SQLiteModule = typeof import("node:sqlite");
export type DatabaseSync = import("node:sqlite").DatabaseSync;

export type TaskRow = {
  task_id: string;
  status: Task["status"];
  ttl: number | null;
  expires_at: number | null;
  created_at: string;
  last_updated_at: string;
  poll_interval: number | null;
  status_message: string | null;
  result_json: string | null;
};

export type RecoveryTaskRow = {
  task_id: string;
  status: Task["status"];
  ttl: number | null;
};

export type SessionRow = {
  id: string;
  native_session_id: string | null;
  created_at: number;
  updated_at: number;
  turns_json: string;
};

export type OrchestratorRow = {
  orchestrator_id: string;
  graph_json: string;
  state_json: string;
  summary_json: string;
  context_json: string | null;
  runtime_json: string | null;
  events_json: string | null;
  final_summary_json: string | null;
  updated_at: string;
};

export type TableInfoRow = {
  name: string;
};

export interface SQLiteRecoverySummary {
  interruptedTasksRecovered: number;
  clearedQueuedMessages: number;
}

export interface PersistOrchestratorSnapshotInput {
  orchestratorId: string;
  graph: ExecutionGraph;
  state: OrchestratorState;
  summary: OrchestratorRuntimeSummary;
  context?: PersistedOrchestratorContext;
  runtime?: PersistedOrchestratorRuntimeState;
  events?: OrchestratorEvent[];
  finalSummary?: OrchestratorFinalSummary;
  updatedAt?: string;
}

export interface OrchestratorSnapshot {
  orchestrator_id: string;
  graph: ExecutionGraph;
  state: OrchestratorState;
  summary: OrchestratorRuntimeSummary;
  context?: PersistedOrchestratorContext;
  runtime?: PersistedOrchestratorRuntimeState;
  events?: OrchestratorEvent[];
  final_summary?: OrchestratorFinalSummary;
  updated_at: string;
}

export interface OrchestratorStore {
  saveOrchestratorSnapshot(input: PersistOrchestratorSnapshotInput): void;
  loadOrchestratorSnapshot(orchestratorId: string): OrchestratorSnapshot | null;
  listOrchestratorRuns(limit?: number): OrchestratorSnapshot[];
  listRecoverableOrchestratorRuns(limit?: number): OrchestratorSnapshot[];
}

export interface SQLitePersistenceRuntime {
  taskStore: TaskStore;
  taskMessageQueue: TaskMessageQueue;
  sessionStore: GeminiSessionStore;
  orchestratorStore: OrchestratorStore;
  dbPath: string;
  recovery: SQLiteRecoverySummary;
}
