import type { CallToolResult, Task } from "@modelcontextprotocol/sdk/types.js";
import type {
  AnySchema,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { TaskProgressStage } from "./task-execution.js";

export const DEFAULT_TASK_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_TASK_POLL_INTERVAL_MS = 2_000;
export const TASK_CANCELLATION_POLL_INTERVAL_MS = 500;

export interface OptionalTaskToolContext {
  taskId?: string;
  signal?: AbortSignal;
  throwIfAborted?: () => void;
  reportProgressStage?: (
    stage: TaskProgressStage,
    detail?: string,
  ) => Promise<void>;
}

export interface TaskStatusReader {
  getTask(taskId: string): Promise<Pick<Task, "status"> | null>;
}

export interface TaskToolExecutionStore extends TaskStatusReader {
  updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
  ): Promise<void>;
  storeTaskResult(
    taskId: string,
    status: "completed" | "failed",
    result: CallToolResult,
  ): Promise<void>;
}

export interface TaskToolExecutionOptions {
  mode?: "immediate" | "queued";
  queueKey?: string;
  concurrencyLimit?: number;
}

export interface TaskToolRegistrationOptions<
  OutputArgs extends ZodRawShapeCompat | AnySchema | undefined = undefined,
> {
  outputSchema?: OutputArgs;
  taskSupport?: "optional" | "required";
  execution?: TaskToolExecutionOptions;
}

export type TaskToolHandler<Args extends Record<string, unknown>> = (
  args: Args,
  context?: OptionalTaskToolContext,
) => Promise<CallToolResult>;
