import { log } from "./gemini-runner.js";
import { appendOrchestratorEvent } from "./orchestrator-summary.js";
import type { PersistedOrchestratorRuntimeState } from "./orchestrator-runtime.js";
import type { OrchestratorSnapshot } from "./sqlite-persistence.js";
import {
  appendMissingTaskEvents,
  createQueuedRuntimeState,
  nowIso,
  persistSnapshot,
} from "./orchestrator-runtime-manager-helpers.js";
import {
  processManagedRun,
  type ProcessManagedRunResult,
} from "./orchestrator-runtime-manager-process.js";
import {
  DEFAULT_ORCHESTRATOR_LOOP_RUNNER,
  type OrchestratorLoopRunner,
  type OrchestratorRuntimeManagerDiagnostics,
  type OrchestratorRuntimeManagerOptions,
  type RunStatusRecord,
} from "./orchestrator-runtime-manager-types.js";

export type {
  ManagedOrchestratorRunDiagnostic,
  OrchestratorLoopRunner,
  OrchestratorRuntimeManagerDiagnostics,
  OrchestratorRuntimeManagerOptions,
} from "./orchestrator-runtime-manager-types.js";

export class OrchestratorRuntimeManager {
  private readonly tickMs: number;
  private readonly maxActiveRuns: number;
  private readonly recoveryLimit: number;
  private readonly maxGeminiRetries: number;
  private readonly runner: OrchestratorLoopRunner;
  private readonly trackedRuns = new Map<string, RunStatusRecord>();
  private readonly queuedRunIds: string[] = [];
  private readonly runningRunIds = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private recoveredRuns = 0;

  constructor(private readonly options: OrchestratorRuntimeManagerOptions) {
    this.tickMs = options.tickMs ?? 1500;
    this.maxActiveRuns = options.maxActiveRuns ?? 2;
    this.recoveryLimit = options.recoveryLimit ?? 100;
    this.maxGeminiRetries = options.maxGeminiRetries ?? 2;
    this.runner = options.runner ?? DEFAULT_ORCHESTRATOR_LOOP_RUNNER;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    const snapshots =
      this.options.orchestratorStore?.listRecoverableOrchestratorRuns(
        this.recoveryLimit,
      ) ?? [];
    this.recoveredRuns = snapshots.length;
    for (const snapshot of snapshots) {
      this.enqueueSnapshot(snapshot, true);
    }

    this.timer = setInterval(() => {
      void this.dispatch();
    }, this.tickMs);
    void this.dispatch();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  register(orchestratorId: string): boolean {
    const snapshot =
      this.options.orchestratorStore?.loadOrchestratorSnapshot(orchestratorId);
    if (!snapshot) {
      return false;
    }

    this.enqueueSnapshot(snapshot, false);
    void this.dispatch();
    return true;
  }

  getDiagnostics(): OrchestratorRuntimeManagerDiagnostics {
    return {
      started: this.timer !== null,
      tick_ms: this.tickMs,
      max_active_runs: this.maxActiveRuns,
      max_gemini_retries: this.maxGeminiRetries,
      queued_runs: this.queuedRunIds.length,
      running_runs: this.runningRunIds.size,
      tracked_runs: [...this.trackedRuns.values()].sort((left, right) => {
        return left.orchestrator_id.localeCompare(right.orchestrator_id);
      }),
      recovered_runs: this.recoveredRuns,
    };
  }

  private enqueueSnapshot(
    snapshot: OrchestratorSnapshot,
    recovered: boolean,
  ): void {
    const store = this.options.orchestratorStore;
    if (!store) {
      return;
    }

    const updatedAt = nowIso();
    let nextSnapshot: OrchestratorSnapshot = {
      ...snapshot,
      runtime: createQueuedRuntimeState(updatedAt, snapshot.runtime),
      updated_at: updatedAt,
      events: appendMissingTaskEvents(snapshot),
    };

    if (recovered) {
      nextSnapshot = {
        ...nextSnapshot,
        events: appendOrchestratorEvent(nextSnapshot.events, {
          level: "info",
          event_type: "run-recovered",
          ts: updatedAt,
          message: `Recovered orchestrator run '${snapshot.orchestrator_id}' into the background queue.`,
        }),
      };
    }

    nextSnapshot = persistSnapshot(store, nextSnapshot);
    this.track(
      snapshot.orchestrator_id,
      nextSnapshot.runtime as PersistedOrchestratorRuntimeState,
    );

    if (
      !this.runningRunIds.has(snapshot.orchestrator_id) &&
      !this.queuedRunIds.includes(snapshot.orchestrator_id)
    ) {
      this.queuedRunIds.push(snapshot.orchestrator_id);
    }

    if (recovered) {
      log("info", "Recovered orchestrator run into background queue", {
        orchestratorId: snapshot.orchestrator_id,
      });
    }
  }

  private track(
    orchestratorId: string,
    runtime: PersistedOrchestratorRuntimeState,
  ): void {
    this.trackedRuns.set(orchestratorId, {
      orchestrator_id: orchestratorId,
      status: runtime.status,
      active: runtime.active,
      updated_at: runtime.updated_at,
    });
  }

  private async dispatch(): Promise<void> {
    while (
      this.runningRunIds.size < this.maxActiveRuns &&
      this.queuedRunIds.length > 0
    ) {
      const orchestratorId = this.queuedRunIds.shift();
      if (!orchestratorId || this.runningRunIds.has(orchestratorId)) {
        continue;
      }

      this.runningRunIds.add(orchestratorId);
      void this.processRun(orchestratorId).finally(() => {
        this.runningRunIds.delete(orchestratorId);
      });
    }
  }

  private applyProcessResult(
    orchestratorId: string,
    result: ProcessManagedRunResult,
  ): void {
    if (result.type === "drop-track") {
      this.trackedRuns.delete(orchestratorId);
      return;
    }

    this.track(orchestratorId, result.runtime);
    if (result.requeue && !this.queuedRunIds.includes(orchestratorId)) {
      this.queuedRunIds.push(orchestratorId);
    }
  }

  private async processRun(orchestratorId: string): Promise<void> {
    const store = this.options.orchestratorStore;
    if (!store) {
      return;
    }

    const result = await processManagedRun({
      orchestratorId,
      store,
      runner: this.runner,
      taskStore: this.options.taskStore,
      geminiTaskSubmitter: this.options.geminiTaskSubmitter,
      maxGeminiRetries: this.maxGeminiRetries,
    });

    this.applyProcessResult(orchestratorId, result);
  }
}
