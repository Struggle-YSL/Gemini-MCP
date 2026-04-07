import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runGeminiTool } from "../gemini-runner.js";
import { buildContextSection, ProjectContext } from "../context-builder.js";
import {
  OptionalTaskToolContext,
  registerOptionalTaskTool,
} from "../task-tool.js";
import {
  createStructuredToolResult,
  parseStructuredResult,
} from "../orchestrator-tools.js";
import {
  frontendPlanFragmentSchema,
  frontendPlanOutputSchema,
  ORCHESTRATOR_SCHEMA_VERSION,
  planFrontendSolutionInputSchema,
  type PlanFrontendSolutionInput,
} from "../orchestrator-contracts.js";

export async function executePlanFrontendSolution(
  args: PlanFrontendSolutionInput,
  _context?: OptionalTaskToolContext,
): Promise<CallToolResult> {
  const {
    goal,
    scope,
    constraints,
    backend_contracts,
    acceptance_criteria,
    project_context,
    session_id,
  } = args;
  const contextBlock = buildContextSection(project_context as ProjectContext);
  const prompt = [
    "You are the frontend planning executor for a Codex orchestrator.",
    contextBlock,
    `Goal: ${goal}`,
    `Scope: ${scope.join(", ")}`,
    constraints?.length ? `Constraints: ${constraints.join(" | ")}` : "",
    backend_contracts?.length
      ? `Backend contracts: ${backend_contracts.join(" | ")}`
      : "",
    acceptance_criteria?.length
      ? `Acceptance criteria: ${acceptance_criteria.join(" | ")}`
      : "",
    "Return exactly one JSON object with these keys:",
    '{"summary":"","ui_changes":[],"components":[],"api_dependencies":[],"risks":[],"tests":[],"assumptions":[]}',
    "Rules:",
    "- Do not include markdown fences or explanations.",
    "- Keep every array item concise and action-oriented.",
    "- summary must be a short paragraph.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await runGeminiTool("plan_frontend_solution", prompt, {
    sessionId: session_id,
  });
  const fragment = parseStructuredResult(
    "plan_frontend_solution",
    result.text,
    frontendPlanFragmentSchema,
  );

  return createStructuredToolResult({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    session_id: result.sessionId,
    session_reused: result.sessionReused,
    ...fragment,
  });
}

export function registerPlanFrontendSolution(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "plan_frontend_solution",
    "为 Codex 主 agent 生成结构化前端方案片段，不直接生成代码文件",
    planFrontendSolutionInputSchema.shape,
    async (args, context) => {
      return await executePlanFrontendSolution(
        args as PlanFrontendSolutionInput,
        context,
      );
    },
    {
      outputSchema: frontendPlanOutputSchema.shape,
    },
  );
}
