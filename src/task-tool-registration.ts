import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AnySchema,
  ShapeOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult, Request, Task } from "@modelcontextprotocol/sdk/types.js";
import type {
  CreateTaskRequestHandlerExtra,
  TaskRequestHandlerExtra,
  TaskStore,
  ToolTaskHandler,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { randomUUID } from "node:crypto";
import { executeTaskHandler, startTaskCancellationWatcher } from "./task-tool-lifecycle.js";
import { scheduleTaskExecution } from "./task-tool-scheduling.js";
import type {
  OptionalTaskToolContext,
  TaskToolExecutionOptions,
  TaskToolExecutionStore,
  TaskToolHandler,
  TaskToolRegistrationOptions,
} from "./task-tool-types.js";
import {
  DEFAULT_TASK_POLL_INTERVAL_MS,
  DEFAULT_TASK_TTL_MS,
} from "./task-tool-types.js";

function createTaskCreationOptions(): { ttl: number; pollInterval: number } {
  return {
    ttl: DEFAULT_TASK_TTL_MS,
    pollInterval: DEFAULT_TASK_POLL_INTERVAL_MS,
  };
}

function createSyntheticToolCallRequest(
  name: string,
  args: Record<string, unknown>,
): Request {
  return {
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  } as Request;
}

function createManagedTaskRunner<Args extends Record<string, unknown>>(
  name: string,
  taskId: string,
  args: Args,
  taskStore: TaskToolExecutionStore,
  handler: TaskToolHandler<Args>,
  controller: AbortController,
  stopWatchingCancellation: () => void,
): () => Promise<void> {
  return () => executeTaskHandler(
    name,
    taskId,
    args,
    { taskStore },
    handler,
    controller,
    stopWatchingCancellation,
  );
}

export async function submitManagedTask(
  name: string,
  args: Record<string, unknown>,
  taskStore: TaskStore,
  handler: TaskToolHandler<Record<string, unknown>>,
  execution?: TaskToolExecutionOptions,
): Promise<Task> {
  const task = await taskStore.createTask(
    createTaskCreationOptions(),
    randomUUID(),
    createSyntheticToolCallRequest(name, args),
  );

  const controller = new AbortController();
  const stopWatchingCancellation = startTaskCancellationWatcher(
    taskStore,
    task.taskId,
    controller,
  );
  const run = createManagedTaskRunner(
    name,
    task.taskId,
    args,
    taskStore,
    handler,
    controller,
    stopWatchingCancellation,
  );

  await scheduleTaskExecution({
    toolName: name,
    taskId: task.taskId,
    execution,
    taskStore,
    run,
    queuedLogMessage: "Task queued for internal orchestrator submission",
    immediateLogMessage: "Task scheduled for internal orchestrator submission",
  });

  return task;
}

function registerTaskTool<
  Args extends ZodRawShapeCompat,
  OutputArgs extends ZodRawShapeCompat | AnySchema | undefined = undefined,
>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Args,
  handler: TaskToolHandler<ShapeOutput<Args>>,
  options?: TaskToolRegistrationOptions<OutputArgs>,
): void {
  const taskHandlers = {
    createTask: async (args: ShapeOutput<Args>, extra: CreateTaskRequestHandlerExtra) => {
      const task = await extra.taskStore.createTask(createTaskCreationOptions());
      const controller = new AbortController();
      const stopWatchingCancellation = startTaskCancellationWatcher(
        extra.taskStore,
        task.taskId,
        controller,
      );
      const run = createManagedTaskRunner(
        name,
        task.taskId,
        args,
        extra.taskStore,
        handler,
        controller,
        stopWatchingCancellation,
      );

      await scheduleTaskExecution({
        toolName: name,
        taskId: task.taskId,
        execution: options?.execution,
        taskStore: extra.taskStore,
        run,
        queuedLogMessage: "Task queued for execution",
        immediateLogMessage: "Task scheduled for immediate execution",
      });

      return { task };
    },
    getTask: async (_args: ShapeOutput<Args>, extra: TaskRequestHandlerExtra) => {
      const task = await extra.taskStore.getTask(extra.taskId);
      if (!task) {
        throw new Error(`Task ${extra.taskId} not found`);
      }
      return task;
    },
    getTaskResult: async (_args: ShapeOutput<Args>, extra: TaskRequestHandlerExtra) => {
      return await extra.taskStore.getTaskResult(extra.taskId) as CallToolResult;
    },
  };

  server.experimental.tasks.registerToolTask(
    name,
    {
      description,
      inputSchema,
      outputSchema: options?.outputSchema,
      execution: {
        taskSupport: options?.taskSupport ?? "optional",
      },
    },
    taskHandlers as ToolTaskHandler<Args>,
  );
}

export function registerOptionalTaskTool<
  Args extends ZodRawShapeCompat,
  OutputArgs extends ZodRawShapeCompat | AnySchema | undefined = undefined,
>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Args,
  handler: (
    args: ShapeOutput<Args>,
    context?: OptionalTaskToolContext,
  ) => Promise<CallToolResult>,
  options?: Omit<TaskToolRegistrationOptions<OutputArgs>, "taskSupport">,
): void {
  registerTaskTool(server, name, description, inputSchema, handler, {
    ...options,
    taskSupport: "optional",
  });
}

export function registerRequiredTaskTool<
  Args extends ZodRawShapeCompat,
  OutputArgs extends ZodRawShapeCompat | AnySchema | undefined = undefined,
>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Args,
  handler: (
    args: ShapeOutput<Args>,
    context?: OptionalTaskToolContext,
  ) => Promise<CallToolResult>,
  options?: Omit<TaskToolRegistrationOptions<OutputArgs>, "taskSupport">,
): void {
  registerTaskTool(server, name, description, inputSchema, handler, {
    ...options,
    taskSupport: "required",
  });
}