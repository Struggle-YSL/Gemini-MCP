import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createStructuredToolResult } from "../orchestrator-tools.js";
import {
  getRuntimeDiagnosticsInputSchema,
  getRuntimeDiagnosticsOutputSchema,
  getRuntimeDiagnosticsSnapshot,
  type GetRuntimeDiagnosticsInput,
  type RuntimeDiagnosticsOptions,
} from "../runtime-diagnostics.js";
import { registerOptionalTaskTool } from "../task-tool.js";

export function registerGetRuntimeDiagnostics(
  server: McpServer,
  options?: RuntimeDiagnosticsOptions,
): void {
  registerOptionalTaskTool(
    server,
    "get_runtime_diagnostics",
    "读取当前进程的 Gemini runtime、task execution、orchestrator runtime 和持久化诊断信息",
    getRuntimeDiagnosticsInputSchema.shape,
    async (args) => {
      const result = getRuntimeDiagnosticsSnapshot(
        args as GetRuntimeDiagnosticsInput,
        options,
      );
      return createStructuredToolResult(result);
    },
    {
      outputSchema: getRuntimeDiagnosticsOutputSchema.shape,
    },
  );
}
