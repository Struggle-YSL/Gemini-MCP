import type { TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { z } from "zod";
import {
  implementFrontendTaskInputSchema,
  ORCHESTRATOR_SCHEMA_VERSION,
  planFrontendSolutionInputSchema,
  relatedFileSchema,
} from "./orchestrator-contracts.js";
import { requiredProjectContextSchema } from "./orchestrator-tools.js";
import {
  orchestratorEventSchema,
  orchestratorFinalSummarySchema,
  orchestratorManualActionSchema,
  orchestratorRetryStateSchema,
} from "./orchestrator-summary.js";
import type {
  OrchestratorSnapshot,
  OrchestratorStore,
} from "./sqlite-persistence.js";
import {
  executionGraphSchema,
  orchestratorStateSchema,
  type ExecutionGraphIssue,
  type OrchestratorState,
} from "./orchestrator-state.js";

export const workItemRuntimeInputSchema = z.object({
  goal: z.string().optional(),
  task_goal: z.string().optional(),
  scope: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  backend_contracts: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  allowed_paths: z.array(z.string()).optional(),
  related_files: z.array(relatedFileSchema).optional(),
  session_id: z.string().optional(),
});

export const taskResultSnapshotSchema = z.object({
  task_id: z.string(),
  status: z.enum(["queued", "working", "completed", "failed", "cancelled"]),
  result: z.unknown().optional(),
  session_id: z.string().optional(),
  thread_id: z.string().optional(),
  updated_at: z.string().optional(),
});

export const sessionBindingInputSchema = z.object({
  session_id: z.string(),
  thread_id: z.string(),
  work_item_ids: z.array(z.string()).min(1),
  updated_at: z.string().optional(),
});

export const blockedWorkItemSchema = z.object({
  work_item_id: z.string(),
  owner: z.enum(["codex", "gemini"]),
  category: z.enum(["dependency", "task-running", "missing-input", "graph-invalid", "working"]),
  reason: z.string(),
});

export const codexWorkActionSchema = z.object({
  kind: z.literal("codex-work"),
  work_item_id: z.string(),
  title: z.string(),
  instructions: z.string(),
  payload: z.object({
    scope: z.string(),
    input: z.record(z.string(), z.unknown()),
    acceptance: z.array(z.string()),
  }),
});

export const geminiPlanActionSchema = z.object({
  kind: z.literal("gemini-plan"),
  work_item_id: z.string(),
  title: z.string(),
  tool_name: z.literal("plan_frontend_solution"),
  arguments: planFrontendSolutionInputSchema,
});

export const geminiCodeActionSchema = z.object({
  kind: z.literal("gemini-code"),
  work_item_id: z.string(),
  title: z.string(),
  tool_name: z.literal("implement_frontend_task"),
  arguments: implementFrontendTaskInputSchema,
});

export const executionGraphIssueSchema = z.object({
  code: z.enum(["duplicate-work-item-id", "missing-dependency", "cyclic-dependency", "invalid-owner"]),
  work_item_id: z.string().optional(),
  dependency_id: z.string().optional(),
  message: z.string(),
});

export const orchestratorRuntimeSummarySchema = z.object({
  status: z.enum(["ok", "invalid-graph"]),
  message: z.string(),
  ready_work_item_ids: z.array(z.string()),
  waiting_work_item_ids: z.array(z.string()),
  completed_work_item_ids: z.array(z.string()),
  failed_work_item_ids: z.array(z.string()),
});

export const runOrchestratorGraphInputSchema = z.object({
  graph: executionGraphSchema,
  state: orchestratorStateSchema.optional(),
  project_context: requiredProjectContextSchema,
  backend_contracts: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  work_item_inputs: z.record(z.string(), workItemRuntimeInputSchema).optional(),
  task_results: z.array(taskResultSnapshotSchema).optional(),
  session_bindings: z.array(sessionBindingInputSchema).optional(),
  orchestrator_id: z.string().optional(),
  persist: z.boolean().optional(),
  load_if_exists: z.boolean().optional(),
});

export const persistedOrchestratorContextSchema = z.object({
  project_context: requiredProjectContextSchema,
  backend_contracts: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  work_item_inputs: z.record(z.string(), workItemRuntimeInputSchema).optional(),
});

export const persistedOrchestratorRuntimeStateSchema = z.object({
  status: z.enum([
    "queued",
    "running",
    "waiting_for_codex",
    "idle",
    "completed",
    "failed",
    "invalid-graph",
    "failed-recovery",
    "manual-review-required",
  ]),
  active: z.boolean(),
  updated_at: z.string(),
  last_tick_at: z.string().optional(),
  last_error: z.string().optional(),
  work_item_retry_state: z.array(orchestratorRetryStateSchema).optional(),
  manual_actions: z.array(orchestratorManualActionSchema).optional(),
});

export const orchestratorSnapshotSchema = z.object({
  orchestrator_id: z.string(),
  graph: executionGraphSchema,
  state: orchestratorStateSchema,
  summary: orchestratorRuntimeSummarySchema,
  context: persistedOrchestratorContextSchema.optional(),
  runtime: persistedOrchestratorRuntimeStateSchema.optional(),
  events: z.array(orchestratorEventSchema).optional(),
  final_summary: orchestratorFinalSummarySchema.optional(),
  updated_at: z.string(),
});

export const orchestratorNextActionSchema = z.union([
  codexWorkActionSchema,
  geminiPlanActionSchema,
  geminiCodeActionSchema,
]);

export const runOrchestratorGraphOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  orchestrator_id: z.string().optional(),
  persisted: z.boolean(),
  loaded_from_store: z.boolean(),
  persistence_warning: z.string().optional(),
  updated_at: z.string(),
  state: orchestratorStateSchema,
  next_actions: z.array(orchestratorNextActionSchema),
  completed_work_items: z.array(z.string()),
  blocked_work_items: z.array(blockedWorkItemSchema),
  graph_validation_issues: z.array(executionGraphIssueSchema),
  summary: orchestratorRuntimeSummarySchema,
});

export const submittedTaskSchema = z.object({
  work_item_id: z.string(),
  task_id: z.string(),
  tool_name: z.enum(["plan_frontend_solution", "implement_frontend_task"]),
  session_id: z.string().optional(),
});

export const runOrchestratorLoopInputSchema = runOrchestratorGraphInputSchema.extend({
  auto_submit_gemini: z.boolean().optional(),
  max_submissions: z.number().int().min(1).optional(),
});

export const runOrchestratorLoopOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  orchestrator_id: z.string().optional(),
  persisted: z.boolean(),
  loaded_from_store: z.boolean(),
  persistence_warning: z.string().optional(),
  updated_at: z.string(),
  state: orchestratorStateSchema,
  submitted_tasks: z.array(submittedTaskSchema),
  codex_actions: z.array(codexWorkActionSchema),
  blocked_work_items: z.array(blockedWorkItemSchema),
  graph_validation_issues: z.array(executionGraphIssueSchema),
  summary: orchestratorRuntimeSummarySchema,
});

export const getOrchestratorStateInputSchema = z.object({
  orchestrator_id: z.string(),
});

export const getOrchestratorStateOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  snapshot: orchestratorSnapshotSchema,
});

export const getOrchestratorSummaryInputSchema = z.object({
  orchestrator_id: z.string(),
});

export const getOrchestratorSummaryOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  summary: orchestratorFinalSummarySchema,
  events: z.array(orchestratorEventSchema),
});

export type WorkItemRuntimeInput = z.infer<typeof workItemRuntimeInputSchema>;
export type TaskResultSnapshot = z.infer<typeof taskResultSnapshotSchema>;
export type SessionBindingInput = z.infer<typeof sessionBindingInputSchema>;
export type BlockedWorkItem = z.infer<typeof blockedWorkItemSchema>;
export type CodexWorkAction = z.infer<typeof codexWorkActionSchema>;
export type GeminiPlanAction = z.infer<typeof geminiPlanActionSchema>;
export type GeminiCodeAction = z.infer<typeof geminiCodeActionSchema>;
export type OrchestratorNextAction = z.infer<typeof orchestratorNextActionSchema>;
export type OrchestratorRuntimeSummary = z.infer<typeof orchestratorRuntimeSummarySchema>;
export type RunOrchestratorGraphInput = z.infer<typeof runOrchestratorGraphInputSchema>;
export type PersistedOrchestratorContext = z.infer<typeof persistedOrchestratorContextSchema>;
export type PersistedOrchestratorRuntimeState = z.infer<typeof persistedOrchestratorRuntimeStateSchema>;
export type RunOrchestratorGraphOutput = z.infer<typeof runOrchestratorGraphOutputSchema>;
export type GetOrchestratorStateInput = z.infer<typeof getOrchestratorStateInputSchema>;
export type GetOrchestratorStateOutput = z.infer<typeof getOrchestratorStateOutputSchema>;
export type GetOrchestratorSummaryInput = z.infer<typeof getOrchestratorSummaryInputSchema>;
export type GetOrchestratorSummaryOutput = z.infer<typeof getOrchestratorSummaryOutputSchema>;
export type SubmittedTask = z.infer<typeof submittedTaskSchema>;
export type RunOrchestratorLoopInput = z.infer<typeof runOrchestratorLoopInputSchema>;
export type RunOrchestratorLoopOutput = z.infer<typeof runOrchestratorLoopOutputSchema>;

export interface RunOrchestratorGraphOptions {
  orchestratorStore?: OrchestratorStore;
  taskStore?: TaskStore;
}

export interface GeminiTaskSubmitter {
  submit(action: GeminiPlanAction | GeminiCodeAction): Promise<SubmittedTask>;
}

export interface RunOrchestratorLoopOptions extends RunOrchestratorGraphOptions {
  geminiTaskSubmitter?: GeminiTaskSubmitter;
}

export type OrchestratorRuntimeContext = {
  orchestratorStore?: OrchestratorStore;
  taskStore?: TaskStore;
};

export type GraphValidationIssue = ExecutionGraphIssue;
export type RuntimeState = OrchestratorState;
export type RuntimeSnapshot = OrchestratorSnapshot;