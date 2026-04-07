import type { TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createStructuredToolResult } from "../orchestrator-tools.js";
import {
  runOrchestratorLoop,
  runOrchestratorLoopInputSchema,
  runOrchestratorLoopOutputSchema,
  type GeminiCodeAction,
  type GeminiPlanAction,
  type GeminiTaskSubmitter,
  type RunOrchestratorLoopInput,
  type SubmittedTask,
} from "../orchestrator-runtime.js";
import type { OrchestratorRuntimeManager } from "../orchestrator-runtime-manager.js";
import type { OrchestratorStore } from "../sqlite-persistence.js";
import { registerOptionalTaskTool, submitManagedTask } from "../task-tool.js";
import {
  executeImplementFrontendTask,
  getImplementFrontendTaskExecutionOptions,
} from "./implement-frontend-task.js";
import { executePlanFrontendSolution } from "./plan-frontend-solution.js";

export function createGeminiTaskSubmitter(taskStore: TaskStore): GeminiTaskSubmitter {
  return {
    submit: async (action: GeminiPlanAction | GeminiCodeAction): Promise<SubmittedTask> => {
      if (action.kind === "gemini-plan") {
        const task = await submitManagedTask(
          action.tool_name,
          action.arguments as any,
          taskStore,
          executePlanFrontendSolution as any,
        );
        return {
          work_item_id: action.work_item_id,
          task_id: task.taskId,
          tool_name: action.tool_name,
          session_id: action.arguments.session_id,
        };
      }

      const task = await submitManagedTask(
        action.tool_name,
        action.arguments as any,
        taskStore,
        executeImplementFrontendTask as any,
        getImplementFrontendTaskExecutionOptions(),
      );
      return {
        work_item_id: action.work_item_id,
        task_id: task.taskId,
        tool_name: action.tool_name,
        session_id: action.arguments.session_id,
      };
    },
  };
}

export function registerRunOrchestratorLoop(
  server: McpServer,
  options?: {
    orchestratorStore?: OrchestratorStore;
    taskStore?: TaskStore;
    runtimeManager?: OrchestratorRuntimeManager;
  },
): void {
  registerOptionalTaskTool(
    server,
    "run_orchestrator_loop",
    "执行一次 orchestrator loop tick：推进 DAG、自动提交 ready 的 Gemini work item，并返回更新后的编排状态",
    runOrchestratorLoopInputSchema.shape,
    async (args) => {
      const result = await runOrchestratorLoop(args as RunOrchestratorLoopInput, {
        orchestratorStore: options?.orchestratorStore,
        taskStore: options?.taskStore,
        geminiTaskSubmitter: options?.taskStore
          ? createGeminiTaskSubmitter(options.taskStore)
          : undefined,
      });
      if (result.persisted && result.orchestrator_id) {
        options?.runtimeManager?.register(result.orchestrator_id);
      }
      return createStructuredToolResult(result);
    },
    {
      outputSchema: runOrchestratorLoopOutputSchema.shape,
    },
  );
}