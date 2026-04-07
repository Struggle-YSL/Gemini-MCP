import { z } from "zod";
import { ORCHESTRATOR_SCHEMA_VERSION } from "./orchestrator-contracts.js";

export const workItemTypeSchema = z.enum([
  "backend",
  "frontend-plan",
  "frontend-code",
  "integration",
]);

export const workItemOwnerSchema = z.enum(["codex", "gemini"]);
export const workItemStatusSchema = z.enum([
  "queued",
  "working",
  "completed",
  "failed",
]);

export const workItemSchema = z.object({
  id: z.string(),
  type: workItemTypeSchema,
  owner: workItemOwnerSchema,
  scope: z.string(),
  deps: z.array(z.string()),
  status: workItemStatusSchema,
  input: z.record(z.string(), z.unknown()),
  acceptance: z.array(z.string()),
});

export const executionGraphSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  work_items: z.array(workItemSchema),
});

export const taskWorkItemBindingSchema = z.object({
  task_id: z.string(),
  work_item_id: z.string(),
  tool_name: z.string(),
  session_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const frontendThreadBindingSchema = z.object({
  session_id: z.string(),
  thread_id: z.string(),
  work_item_ids: z.array(z.string()),
  updated_at: z.string(),
});

export const workItemResultSchema = z.object({
  work_item_id: z.string(),
  payload: z.unknown(),
  updated_at: z.string(),
});

export const orchestratorStateSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  work_items: z.array(workItemSchema),
  task_bindings: z.array(taskWorkItemBindingSchema),
  frontend_threads: z.array(frontendThreadBindingSchema),
  work_item_results: z.array(workItemResultSchema),
});

export type WorkItemType = z.infer<typeof workItemTypeSchema>;
export type WorkItemOwner = z.infer<typeof workItemOwnerSchema>;
export type WorkItemStatus = z.infer<typeof workItemStatusSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type ExecutionGraph = z.infer<typeof executionGraphSchema>;
export type TaskWorkItemBinding = z.infer<typeof taskWorkItemBindingSchema>;
export type FrontendThreadBinding = z.infer<typeof frontendThreadBindingSchema>;
export type WorkItemResult = z.infer<typeof workItemResultSchema>;
export type OrchestratorState = z.infer<typeof orchestratorStateSchema>;

export type ExecutionGraphIssueCode =
  | "duplicate-work-item-id"
  | "missing-dependency"
  | "cyclic-dependency"
  | "invalid-owner";

export interface ExecutionGraphIssue {
  code: ExecutionGraphIssueCode;
  work_item_id?: string;
  dependency_id?: string;
  message: string;
}

export interface ExecutionGraphValidationReport {
  ok: boolean;
  graph: ExecutionGraph;
  ordered_work_item_ids: string[];
  issues: ExecutionGraphIssue[];
}

function expectedOwner(type: WorkItemType): WorkItemOwner {
  return type === "frontend-plan" || type === "frontend-code"
    ? "gemini"
    : "codex";
}

function validateOwnerConsistency(
  graph: ExecutionGraph,
): ExecutionGraphIssue[] {
  const issues: ExecutionGraphIssue[] = [];

  for (const workItem of graph.work_items) {
    const owner = expectedOwner(workItem.type);
    if (workItem.owner !== owner) {
      issues.push({
        code: "invalid-owner",
        work_item_id: workItem.id,
        message: `Work item '${workItem.id}' of type '${workItem.type}' must be owned by '${owner}'.`,
      });
    }
  }

  return issues;
}

function topologicalValidate(graph: ExecutionGraph): {
  orderedWorkItemIds: string[];
  issues: ExecutionGraphIssue[];
} {
  const issues: ExecutionGraphIssue[] = [];
  const workItemIds = new Set<string>();
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const workItem of graph.work_items) {
    if (workItemIds.has(workItem.id)) {
      issues.push({
        code: "duplicate-work-item-id",
        work_item_id: workItem.id,
        message: `Duplicate work item id '${workItem.id}' detected in execution graph.`,
      });
      continue;
    }

    workItemIds.add(workItem.id);
    adjacency.set(workItem.id, []);
    indegree.set(workItem.id, 0);
  }

  for (const workItem of graph.work_items) {
    if (!workItemIds.has(workItem.id)) {
      continue;
    }

    for (const dependencyId of workItem.deps) {
      if (!workItemIds.has(dependencyId)) {
        issues.push({
          code: "missing-dependency",
          work_item_id: workItem.id,
          dependency_id: dependencyId,
          message: `Work item '${workItem.id}' depends on missing work item '${dependencyId}'.`,
        });
        continue;
      }

      adjacency.get(dependencyId)?.push(workItem.id);
      indegree.set(workItem.id, (indegree.get(workItem.id) ?? 0) + 1);
    }
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const orderedWorkItemIds: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    orderedWorkItemIds.push(current);
    for (const dependentId of adjacency.get(current) ?? []) {
      const nextDegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        queue.push(dependentId);
        queue.sort();
      }
    }
  }

  if (orderedWorkItemIds.length !== workItemIds.size) {
    for (const [workItemId, degree] of indegree.entries()) {
      if (degree > 0) {
        issues.push({
          code: "cyclic-dependency",
          work_item_id: workItemId,
          message: `Work item '${workItemId}' participates in a dependency cycle or unresolved dependency chain.`,
        });
      }
    }
  }

  return {
    orderedWorkItemIds,
    issues,
  };
}

export function createWorkItem(
  input: Omit<WorkItem, "deps" | "status" | "input" | "acceptance"> &
    Partial<Pick<WorkItem, "deps" | "status" | "input" | "acceptance">>,
): WorkItem {
  return workItemSchema.parse({
    ...input,
    deps: input.deps ?? [],
    status: input.status ?? "queued",
    input: input.input ?? {},
    acceptance: input.acceptance ?? [],
  });
}

export function validateExecutionGraph(
  raw: unknown,
): ExecutionGraphValidationReport {
  const graph = executionGraphSchema.parse(raw);
  const ownerIssues = validateOwnerConsistency(graph);
  const topology = topologicalValidate(graph);
  const issues = [...ownerIssues, ...topology.issues];

  return {
    ok: issues.length === 0,
    graph,
    ordered_work_item_ids: topology.orderedWorkItemIds,
    issues,
  };
}

export function getReadyWorkItems(graph: ExecutionGraph): WorkItem[] {
  const completedWorkItemIds = new Set(
    graph.work_items
      .filter((workItem) => workItem.status === "completed")
      .map((workItem) => workItem.id),
  );

  return graph.work_items.filter((workItem) => {
    return (
      workItem.status === "queued" &&
      workItem.deps.every((dependencyId) =>
        completedWorkItemIds.has(dependencyId),
      )
    );
  });
}

export function createOrchestratorState(
  graph?: ExecutionGraph,
): OrchestratorState {
  return orchestratorStateSchema.parse({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    work_items: graph?.work_items ?? [],
    task_bindings: [],
    frontend_threads: [],
    work_item_results: [],
  });
}

function cloneState(state: OrchestratorState): OrchestratorState {
  return {
    schema_version: state.schema_version,
    work_items: state.work_items.map((workItem) => ({
      ...workItem,
      deps: [...workItem.deps],
      acceptance: [...workItem.acceptance],
      input: { ...workItem.input },
    })),
    task_bindings: state.task_bindings.map((binding) => ({ ...binding })),
    frontend_threads: state.frontend_threads.map((binding) => ({
      ...binding,
      work_item_ids: [...binding.work_item_ids],
    })),
    work_item_results: state.work_item_results.map((result) => ({ ...result })),
  };
}

function requireWorkItem(
  state: OrchestratorState,
  workItemId: string,
): WorkItem {
  const workItem = state.work_items.find((item) => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Unknown work item '${workItemId}'.`);
  }

  return workItem;
}

function canTransitionStatus(
  currentStatus: WorkItemStatus,
  nextStatus: WorkItemStatus,
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  const allowed: Record<WorkItemStatus, WorkItemStatus[]> = {
    queued: ["working", "completed", "failed"],
    working: ["completed", "failed"],
    completed: [],
    failed: [],
  };

  return allowed[currentStatus].includes(nextStatus);
}

export function transitionWorkItemStatus(
  state: OrchestratorState,
  workItemId: string,
  nextStatus: WorkItemStatus,
): OrchestratorState {
  const nextState = cloneState(state);
  const workItem = requireWorkItem(nextState, workItemId);

  if (!canTransitionStatus(workItem.status, nextStatus)) {
    throw new Error(
      `Invalid work item status transition for '${workItemId}': '${workItem.status}' -> '${nextStatus}'.`,
    );
  }

  if (nextStatus === "working") {
    const unmetDependency = workItem.deps.find((dependencyId) => {
      const dependency = requireWorkItem(nextState, dependencyId);
      return dependency.status !== "completed";
    });

    if (unmetDependency) {
      throw new Error(
        `Cannot start work item '${workItemId}' before dependency '${unmetDependency}' completes.`,
      );
    }
  }

  workItem.status = nextStatus;
  return orchestratorStateSchema.parse(nextState);
}

export function bindTaskToWorkItem(
  state: OrchestratorState,
  input: Omit<TaskWorkItemBinding, "created_at" | "updated_at"> &
    Partial<Pick<TaskWorkItemBinding, "created_at" | "updated_at">>,
): OrchestratorState {
  const nextState = cloneState(state);
  const workItem = requireWorkItem(nextState, input.work_item_id);
  const now = new Date().toISOString();

  if (workItem.type !== "frontend-plan" && workItem.type !== "frontend-code") {
    throw new Error(
      `Task bindings are only valid for frontend work items. '${input.work_item_id}' is '${workItem.type}'.`,
    );
  }

  const existingTaskBinding = nextState.task_bindings.find(
    (binding) => binding.task_id === input.task_id,
  );
  if (
    existingTaskBinding &&
    existingTaskBinding.work_item_id !== input.work_item_id
  ) {
    throw new Error(
      `Task '${input.task_id}' is already bound to work item '${existingTaskBinding.work_item_id}'.`,
    );
  }

  const duplicateWorkItemBinding = nextState.task_bindings.find((binding) => {
    return (
      binding.work_item_id === input.work_item_id &&
      binding.task_id !== input.task_id
    );
  });
  if (duplicateWorkItemBinding) {
    throw new Error(
      `Work item '${input.work_item_id}' is already bound to task '${duplicateWorkItemBinding.task_id}'.`,
    );
  }

  const binding = taskWorkItemBindingSchema.parse({
    ...input,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  });

  const index = nextState.task_bindings.findIndex(
    (item) => item.task_id === binding.task_id,
  );
  if (index >= 0) {
    nextState.task_bindings[index] = binding;
  } else {
    nextState.task_bindings.push(binding);
  }

  return orchestratorStateSchema.parse(nextState);
}

export function bindFrontendThread(
  state: OrchestratorState,
  input: Omit<FrontendThreadBinding, "updated_at" | "work_item_ids"> &
    Partial<Pick<FrontendThreadBinding, "updated_at" | "work_item_ids">>,
): OrchestratorState {
  const nextState = cloneState(state);
  const now = new Date().toISOString();
  const requestedWorkItemIds = [...new Set(input.work_item_ids ?? [])];

  for (const workItemId of requestedWorkItemIds) {
    const workItem = requireWorkItem(nextState, workItemId);
    if (workItem.owner !== "gemini") {
      throw new Error(
        `Frontend thread bindings can only include Gemini-owned work items. '${workItemId}' is owned by '${workItem.owner}'.`,
      );
    }
  }

  const binding = frontendThreadBindingSchema.parse({
    ...input,
    work_item_ids: requestedWorkItemIds,
    updated_at: input.updated_at ?? now,
  });

  const index = nextState.frontend_threads.findIndex(
    (item) => item.session_id === binding.session_id,
  );
  if (index >= 0) {
    const mergedWorkItemIds = [
      ...new Set([
        ...nextState.frontend_threads[index].work_item_ids,
        ...binding.work_item_ids,
      ]),
    ];
    nextState.frontend_threads[index] = {
      ...binding,
      work_item_ids: mergedWorkItemIds,
    };
  } else {
    nextState.frontend_threads.push(binding);
  }

  return orchestratorStateSchema.parse(nextState);
}

export function setWorkItemResult(
  state: OrchestratorState,
  workItemId: string,
  payload: unknown,
  updatedAt: string = new Date().toISOString(),
): OrchestratorState {
  const nextState = cloneState(state);
  requireWorkItem(nextState, workItemId);

  const result = workItemResultSchema.parse({
    work_item_id: workItemId,
    payload,
    updated_at: updatedAt,
  });

  const index = nextState.work_item_results.findIndex(
    (item) => item.work_item_id === workItemId,
  );
  if (index >= 0) {
    nextState.work_item_results[index] = result;
  } else {
    nextState.work_item_results.push(result);
  }

  return orchestratorStateSchema.parse(nextState);
}

export function getBoundTaskForWorkItem(
  state: OrchestratorState,
  workItemId: string,
): TaskWorkItemBinding | undefined {
  return state.task_bindings.find(
    (binding) => binding.work_item_id === workItemId,
  );
}

export function getFrontendThreadForSession(
  state: OrchestratorState,
  sessionId: string,
): FrontendThreadBinding | undefined {
  return state.frontend_threads.find(
    (binding) => binding.session_id === sessionId,
  );
}
