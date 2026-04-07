import type { TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { ORCHESTRATOR_SCHEMA_VERSION } from "./orchestrator-contracts.js";
import { buildOrchestratorFinalSummary } from "./orchestrator-summary.js";
import type {
  OrchestratorSnapshot,
  OrchestratorStore,
} from "./sqlite-persistence.js";
import {
  bindFrontendThread,
  bindTaskToWorkItem,
  getBoundTaskForWorkItem,
  getReadyWorkItems,
  validateExecutionGraph,
} from "./orchestrator-state.js";
import {
  getOrchestratorStateInputSchema,
  getOrchestratorStateOutputSchema,
  getOrchestratorSummaryInputSchema,
  getOrchestratorSummaryOutputSchema,
  runOrchestratorGraphInputSchema,
  runOrchestratorLoopInputSchema,
  submittedTaskSchema,
  type BlockedWorkItem,
  type CodexWorkAction,
  type GeminiCodeAction,
  type GeminiPlanAction,
  type GetOrchestratorStateInput,
  type GetOrchestratorStateOutput,
  type GetOrchestratorSummaryInput,
  type GetOrchestratorSummaryOutput,
  type RunOrchestratorGraphInput,
  type RunOrchestratorGraphOptions,
  type RunOrchestratorGraphOutput,
  type RunOrchestratorLoopInput,
  type RunOrchestratorLoopOptions,
  type RunOrchestratorLoopOutput,
  type SubmittedTask,
} from "./orchestrator-runtime-schemas.js";
import {
  applySessionBindings,
  applyStoredResults,
  applyTaskSnapshots,
  getRuntimeInput,
  resolveTaskSnapshots,
  setStatusIfNeeded,
  syncStateWithGraph,
} from "./orchestrator-runtime-sync.js";
import {
  createCodexAction,
  createGeminiCodeAction,
  createGeminiPlanAction,
  createGraphIssueBlocks,
  createSummary,
  isTerminalOrchestratorState,
} from "./orchestrator-runtime-actions.js";
import {
  buildGraphOutput,
  buildGraphRuntimeState,
  buildLoopOutput,
  buildLoopRuntimeState,
  buildPersistedContext,
  isCodexAction,
  isGeminiAction,
} from "./orchestrator-runtime-persistence.js";

export * from "./orchestrator-runtime-schemas.js";
export { isTerminalOrchestratorState } from "./orchestrator-runtime-actions.js";

export async function runOrchestratorGraph(
  rawInput: RunOrchestratorGraphInput,
  options?: RunOrchestratorGraphOptions,
): Promise<RunOrchestratorGraphOutput> {
  const input = runOrchestratorGraphInputSchema.parse(rawInput);
  const validation = validateExecutionGraph(input.graph);
  const store = options?.orchestratorStore;
  const shouldPersist = Boolean(input.persist && input.orchestrator_id);
  const persistedContext = buildPersistedContext(input);
  let loadedSnapshot: OrchestratorSnapshot | null = null;
  let loadedFromStore = false;
  let persistenceWarning: string | undefined;

  if (input.load_if_exists && input.orchestrator_id && store) {
    loadedSnapshot = store.loadOrchestratorSnapshot(input.orchestrator_id);
    loadedFromStore = Boolean(loadedSnapshot);
  }

  const baseState = input.state ?? loadedSnapshot?.state;
  let state = syncStateWithGraph(validation.graph, baseState);

  state = applySessionBindings(state, input.session_bindings);
  const taskSnapshots = await resolveTaskSnapshots(
    state,
    input.task_results,
    options?.taskStore,
    input.load_if_exists === true,
  );
  state = applyTaskSnapshots(state, taskSnapshots);
  state = applyStoredResults(state);

  const updatedAt = new Date().toISOString();

  if (!validation.ok) {
    const blocked = createGraphIssueBlocks(validation.issues);
    const summary = createSummary("invalid-graph", [], blocked, state, validation.issues);
    const output = buildGraphOutput({
      orchestrator_id: input.orchestrator_id,
      persisted: false,
      loaded_from_store: loadedFromStore,
      updated_at: updatedAt,
      state,
      next_actions: [],
      blocked_work_items: blocked,
      graph_validation_issues: validation.issues,
      summary,
    });

    if (shouldPersist && store) {
      store.saveOrchestratorSnapshot({
        orchestratorId: input.orchestrator_id as string,
        graph: validation.graph,
        state,
        summary,
        context: persistedContext,
        runtime: buildGraphRuntimeState({
          state,
          next_actions: [],
          blocked_work_items: blocked,
          summary,
        }, updatedAt),
        updatedAt,
      });
      return buildGraphOutput({
        ...output,
        persisted: true,
      });
    }

    if (input.persist && !store) {
      return buildGraphOutput({
        ...output,
        persistence_warning: "SQLite persistence unavailable; orchestrator snapshot was not saved.",
      });
    }

    return output;
  }

  const nextActions = [] as Array<CodexWorkAction | GeminiPlanAction | GeminiCodeAction>;
  const blockedWorkItems: BlockedWorkItem[] = [];
  const order = new Map(validation.ordered_work_item_ids.map((id, index) => [id, index]));
  const readyItems = getReadyWorkItems({
    schema_version: state.schema_version,
    work_items: state.work_items,
  }).sort((left, right) => {
    return (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  });

  for (const workItem of readyItems) {
    const runtimeInput = getRuntimeInput(workItem, input.work_item_inputs);
    const taskBinding = getBoundTaskForWorkItem(state, workItem.id);

    if (taskBinding) {
      state = setStatusIfNeeded(state, workItem.id, "working");
      blockedWorkItems.push({
        work_item_id: workItem.id,
        owner: workItem.owner,
        category: "task-running",
        reason: `Waiting for task '${taskBinding.task_id}' to finish before '${workItem.id}' can advance.`,
      });
      continue;
    }

    if (workItem.owner === "codex") {
      nextActions.push(createCodexAction(workItem));
      continue;
    }

    if (workItem.type === "frontend-plan") {
      nextActions.push(createGeminiPlanAction(workItem, runtimeInput, input, state));
      continue;
    }

    if (!runtimeInput.allowed_paths?.length) {
      blockedWorkItems.push({
        work_item_id: workItem.id,
        owner: workItem.owner,
        category: "missing-input",
        reason: `Frontend code work item '${workItem.id}' requires allowed_paths in work_item_inputs before implement_frontend_task can be called.`,
      });
      continue;
    }

    nextActions.push(createGeminiCodeAction(workItem, runtimeInput, input, state));
  }

  for (const workItem of state.work_items) {
    if (workItem.status === "completed" || workItem.status === "failed") {
      continue;
    }

    const alreadyTracked = nextActions.some((item) => item.work_item_id === workItem.id)
      || blockedWorkItems.some((item) => item.work_item_id === workItem.id);
    if (alreadyTracked) {
      continue;
    }

    if (workItem.status === "working") {
      blockedWorkItems.push({
        work_item_id: workItem.id,
        owner: workItem.owner,
        category: "working",
        reason: `Work item '${workItem.id}' is already marked as working and is waiting for an external update.`,
      });
      continue;
    }

    const unmetDeps = workItem.deps.filter((dependencyId) => {
      const dependency = state.work_items.find((item) => item.id === dependencyId);
      return dependency?.status !== "completed";
    });

    if (unmetDeps.length > 0) {
      blockedWorkItems.push({
        work_item_id: workItem.id,
        owner: workItem.owner,
        category: "dependency",
        reason: `Waiting for dependencies: ${unmetDeps.join(", ")}.`,
      });
    }
  }

  const summary = createSummary("ok", nextActions, blockedWorkItems, state, []);
  let persisted = false;

  if (shouldPersist && store) {
    store.saveOrchestratorSnapshot({
      orchestratorId: input.orchestrator_id as string,
      graph: validation.graph,
      state,
      summary,
      context: persistedContext,
      runtime: buildGraphRuntimeState({
        state,
        next_actions: nextActions,
        blocked_work_items: blockedWorkItems,
        summary,
      }, updatedAt),
      updatedAt,
    });
    persisted = true;
  } else if (input.persist && !store) {
    persistenceWarning = "SQLite persistence unavailable; orchestrator snapshot was not saved.";
  }

  return buildGraphOutput({
    orchestrator_id: input.orchestrator_id,
    persisted,
    loaded_from_store: loadedFromStore,
    persistence_warning: persistenceWarning,
    updated_at: updatedAt,
    state,
    next_actions: nextActions,
    blocked_work_items: blockedWorkItems,
    graph_validation_issues: [],
    summary,
  });
}

export function getOrchestratorState(
  rawInput: GetOrchestratorStateInput,
  options: { orchestratorStore?: OrchestratorStore },
): GetOrchestratorStateOutput {
  const input = getOrchestratorStateInputSchema.parse(rawInput);
  const snapshot = options.orchestratorStore?.loadOrchestratorSnapshot(input.orchestrator_id);

  if (!snapshot) {
    throw new Error(`Orchestrator snapshot '${input.orchestrator_id}' not found.`);
  }

  return getOrchestratorStateOutputSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    snapshot,
  });
}

export function getOrchestratorSummary(
  rawInput: GetOrchestratorSummaryInput,
  options: { orchestratorStore?: OrchestratorStore },
): GetOrchestratorSummaryOutput {
  const input = getOrchestratorSummaryInputSchema.parse(rawInput);
  const snapshot = options.orchestratorStore?.loadOrchestratorSnapshot(input.orchestrator_id);

  if (!snapshot) {
    throw new Error(`Orchestrator snapshot '${input.orchestrator_id}' not found.`);
  }

  return getOrchestratorSummaryOutputSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    summary: snapshot.final_summary ?? buildOrchestratorFinalSummary(snapshot, snapshot.updated_at),
    events: snapshot.events ?? [],
  });
}

export async function runOrchestratorLoop(
  rawInput: RunOrchestratorLoopInput,
  options?: RunOrchestratorLoopOptions,
): Promise<RunOrchestratorLoopOutput> {
  const input = runOrchestratorLoopInputSchema.parse(rawInput);
  const {
    auto_submit_gemini,
    max_submissions,
    ...graphInput
  } = input;
  const maxSubmissions = max_submissions ?? 1;
  const autoSubmitGemini = auto_submit_gemini !== false;

  const initial = await runOrchestratorGraph(graphInput, options);
  const submittedTasks: SubmittedTask[] = [];

  if (initial.summary.status !== "ok") {
    return buildLoopOutput({
      orchestrator_id: initial.orchestrator_id,
      persisted: initial.persisted,
      loaded_from_store: initial.loaded_from_store,
      persistence_warning: initial.persistence_warning,
      updated_at: initial.updated_at,
      state: initial.state,
      submitted_tasks: submittedTasks,
      codex_actions: initial.next_actions.filter(isCodexAction),
      blocked_work_items: initial.blocked_work_items,
      graph_validation_issues: initial.graph_validation_issues,
      summary: initial.summary,
    });
  }

  const geminiActions = initial.next_actions.filter(isGeminiAction);
  if (autoSubmitGemini && geminiActions.length > 0 && !options?.geminiTaskSubmitter) {
    throw new Error("run_orchestrator_loop requires a geminiTaskSubmitter when auto_submit_gemini is enabled.");
  }

  let nextState = initial.state;
  if (autoSubmitGemini && options?.geminiTaskSubmitter) {
    for (const action of geminiActions) {
      if (submittedTasks.length >= maxSubmissions) {
        break;
      }

      const submission = submittedTaskSchema.parse(
        await options.geminiTaskSubmitter.submit(action)
      );
      submittedTasks.push(submission);
      nextState = bindTaskToWorkItem(nextState, {
        task_id: submission.task_id,
        work_item_id: submission.work_item_id,
        tool_name: submission.tool_name,
        session_id: submission.session_id,
      });

      if (submission.session_id) {
        nextState = bindFrontendThread(nextState, {
          session_id: submission.session_id,
          thread_id: submission.session_id,
          work_item_ids: [submission.work_item_id],
        });
      }
    }
  }

  const finalState = submittedTasks.length > 0
    ? await runOrchestratorGraph(
      {
        ...graphInput,
        state: nextState,
        load_if_exists: false,
      },
      options,
    )
    : initial;

  const loopOutput = buildLoopOutput({
    orchestrator_id: finalState.orchestrator_id,
    persisted: finalState.persisted,
    loaded_from_store: initial.loaded_from_store,
    persistence_warning: finalState.persistence_warning,
    updated_at: finalState.updated_at,
    state: finalState.state,
    submitted_tasks: submittedTasks,
    codex_actions: finalState.next_actions.filter(isCodexAction),
    blocked_work_items: finalState.blocked_work_items,
    graph_validation_issues: finalState.graph_validation_issues,
    summary: finalState.summary,
  });

  if (input.persist && input.orchestrator_id && options?.orchestratorStore) {
    options.orchestratorStore.saveOrchestratorSnapshot({
      orchestratorId: input.orchestrator_id,
      graph: input.graph,
      state: loopOutput.state,
      summary: loopOutput.summary,
      context: buildPersistedContext(graphInput),
      runtime: buildLoopRuntimeState(loopOutput, loopOutput.updated_at),
      updatedAt: loopOutput.updated_at,
    });
  }

  return loopOutput;
}