import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createStructuredToolResult } from "../orchestrator-tools.js";
import {
  applyOrchestratorResolution,
  applyOrchestratorResolutionInputSchema,
  applyOrchestratorResolutionOutputSchema,
  getOrchestratorResolution,
  getOrchestratorResolutionInputSchema,
  getOrchestratorResolutionOutputSchema,
  type ApplyOrchestratorResolutionInput,
  type GetOrchestratorResolutionInput,
} from "../orchestrator-resolution.js";
import type { OrchestratorRuntimeManager } from "../orchestrator-runtime-manager.js";
import type { OrchestratorStore } from "../sqlite-persistence.js";
import { registerOptionalTaskTool } from "../task-tool.js";

export function registerGetOrchestratorResolution(
  server: McpServer,
  options?: {
    orchestratorStore?: OrchestratorStore;
  },
): void {
  registerOptionalTaskTool(
    server,
    "get_orchestrator_resolution",
    "读取主 agent 可消费的 orchestrator 决策包，包括 recommended actions、manual actions 和已完成结果摘要",
    getOrchestratorResolutionInputSchema.shape,
    async (args) => {
      const result = getOrchestratorResolution(args as GetOrchestratorResolutionInput, {
        orchestratorStore: options?.orchestratorStore,
      });
      return createStructuredToolResult(result);
    },
    {
      outputSchema: getOrchestratorResolutionOutputSchema.shape,
    },
  );
}

export function registerApplyOrchestratorResolution(
  server: McpServer,
  options?: {
    orchestratorStore?: OrchestratorStore;
    runtimeManager?: OrchestratorRuntimeManager;
  },
): void {
  registerOptionalTaskTool(
    server,
    "apply_orchestrator_resolution",
    "应用 Codex 对 orchestrator run 的决策，支持 provide-result、retry-work-item 和 mark-failed，并按需重新激活后台 runtime",
    applyOrchestratorResolutionInputSchema.shape,
    async (args) => {
      const result = applyOrchestratorResolution(args as ApplyOrchestratorResolutionInput, {
        orchestratorStore: options?.orchestratorStore,
        runtimeManager: options?.runtimeManager,
      });
      return createStructuredToolResult(result);
    },
    {
      outputSchema: applyOrchestratorResolutionOutputSchema.shape,
    },
  );
}