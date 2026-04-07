import type { TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createStructuredToolResult } from "../orchestrator-tools.js";
import {
  getOrchestratorState,
  getOrchestratorStateInputSchema,
  getOrchestratorStateOutputSchema,
  getOrchestratorSummary,
  getOrchestratorSummaryInputSchema,
  getOrchestratorSummaryOutputSchema,
  runOrchestratorGraph,
  runOrchestratorGraphInputSchema,
  runOrchestratorGraphOutputSchema,
  type GetOrchestratorStateInput,
  type GetOrchestratorSummaryInput,
  type RunOrchestratorGraphInput,
} from "../orchestrator-runtime.js";
import type { OrchestratorRuntimeManager } from "../orchestrator-runtime-manager.js";
import type { OrchestratorStore } from "../sqlite-persistence.js";
import { registerOptionalTaskTool } from "../task-tool.js";

export function registerRunOrchestratorGraph(
  server: McpServer,
  options?: {
    orchestratorStore?: OrchestratorStore;
    taskStore?: TaskStore;
    runtimeManager?: OrchestratorRuntimeManager;
  },
): void {
  registerOptionalTaskTool(
    server,
    "run_orchestrator_graph",
    "推进主 agent 的 WorkItem DAG 状态，生成下一步 Codex 或 Gemini 动作，但不直接落盘仓库文件",
    runOrchestratorGraphInputSchema.shape,
    async (args) => {
      const result = await runOrchestratorGraph(
        args as RunOrchestratorGraphInput,
        {
          orchestratorStore: options?.orchestratorStore,
          taskStore: options?.taskStore,
        },
      );
      if (result.persisted && result.orchestrator_id) {
        options?.runtimeManager?.register(result.orchestrator_id);
      }
      return createStructuredToolResult(result);
    },
    {
      outputSchema: runOrchestratorGraphOutputSchema.shape,
    },
  );
}

export function registerGetOrchestratorState(
  server: McpServer,
  options?: {
    orchestratorStore?: OrchestratorStore;
  },
): void {
  registerOptionalTaskTool(
    server,
    "get_orchestrator_state",
    "读取已持久化的 orchestrator graph/state/summary 快照",
    getOrchestratorStateInputSchema.shape,
    async (args) => {
      const result = getOrchestratorState(args as GetOrchestratorStateInput, {
        orchestratorStore: options?.orchestratorStore,
      });
      return createStructuredToolResult(result);
    },
    {
      outputSchema: getOrchestratorStateOutputSchema.shape,
    },
  );
}

export function registerGetOrchestratorSummary(
  server: McpServer,
  options?: {
    orchestratorStore?: OrchestratorStore;
  },
): void {
  registerOptionalTaskTool(
    server,
    "get_orchestrator_summary",
    "读取 orchestrator 的结构化最终汇总、失败补偿状态和 work item 事件轨迹",
    getOrchestratorSummaryInputSchema.shape,
    async (args) => {
      const result = getOrchestratorSummary(
        args as GetOrchestratorSummaryInput,
        {
          orchestratorStore: options?.orchestratorStore,
        },
      );
      return createStructuredToolResult(result);
    },
    {
      outputSchema: getOrchestratorSummaryOutputSchema.shape,
    },
  );
}
