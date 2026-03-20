import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { log } from "./gemini-runner.js";

const DEFAULT_TASK_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TASK_POLL_INTERVAL_MS = 2_000;

function createTaskErrorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function registerOptionalTaskTool<Args extends ZodRawShapeCompat>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Args,
  handler: (args: ShapeOutput<Args>) => Promise<CallToolResult>
): void {
  server.experimental.tasks.registerToolTask(
    name,
    {
      description,
      inputSchema,
      execution: {
        taskSupport: "optional",
      },
    },
    {
      createTask: async (args: any, extra: any) => {
        const task = await extra.taskStore.createTask({
          ttl: DEFAULT_TASK_TTL_MS,
          pollInterval: DEFAULT_TASK_POLL_INTERVAL_MS,
        });

        void (async () => {
          try {
            await extra.taskStore.updateTaskStatus(task.taskId, "working");
            const result = await handler(args as ShapeOutput<Args>);
            await extra.taskStore.storeTaskResult(task.taskId, "completed", result);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log("error", "Gemini MCP task failed", {
              toolName: name,
              taskId: task.taskId,
              error: message,
            });
            await extra.taskStore.storeTaskResult(task.taskId, "failed", createTaskErrorResult(message));
          }
        })();

        return { task };
      },
      getTask: async (_args: any, extra: any) => {
        const task = await extra.taskStore.getTask(extra.taskId);
        if (!task) {
          throw new Error(`Task ${extra.taskId} not found`);
        }
        return task;
      },
      getTaskResult: async (_args: any, extra: any) => {
        return await extra.taskStore.getTaskResult(extra.taskId) as CallToolResult;
      },
    } as any
  );
}
