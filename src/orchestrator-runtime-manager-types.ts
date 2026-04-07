import {
  runOrchestratorLoop,
  type PersistedOrchestratorRuntimeState,
  type RunOrchestratorLoopInput,
  type RunOrchestratorLoopOptions,
  type RunOrchestratorLoopOutput,
} from "./orchestrator-runtime.js";

export interface OrchestratorLoopRunner {
  run(
    input: RunOrchestratorLoopInput,
    options?: RunOrchestratorLoopOptions,
  ): Promise<RunOrchestratorLoopOutput>;
}

export interface OrchestratorRuntimeManagerOptions extends RunOrchestratorLoopOptions {
  tickMs?: number;
  maxActiveRuns?: number;
  recoveryLimit?: number;
  maxGeminiRetries?: number;
  runner?: OrchestratorLoopRunner;
}

export interface ManagedOrchestratorRunDiagnostic {
  orchestrator_id: string;
  status: PersistedOrchestratorRuntimeState["status"];
  active: boolean;
  updated_at: string;
}

export interface OrchestratorRuntimeManagerDiagnostics {
  started: boolean;
  tick_ms: number;
  max_active_runs: number;
  max_gemini_retries: number;
  queued_runs: number;
  running_runs: number;
  tracked_runs: ManagedOrchestratorRunDiagnostic[];
  recovered_runs: number;
}

export type RunStatusRecord = ManagedOrchestratorRunDiagnostic;

export const DEFAULT_ORCHESTRATOR_LOOP_RUNNER: OrchestratorLoopRunner = {
  run: runOrchestratorLoop,
};
