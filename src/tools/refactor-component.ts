import { z } from "zod";
import { runGeminiTool } from "../gemini-runner.js";
import { createSessionAwareToolResult } from "../tool-result.js";
import { buildContextSection, ProjectContext } from "../context-builder.js";
import { registerOptionalTaskTool } from "../task-tool.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const refactorComponentInputSchema = {
  code: z.string().describe("待重构的组件代码"),
  issues: z.string().describe("问题描述，如 prop drilling, no memoization"),
  target_pattern: z.string().optional().describe("目标模式，如 compound component"),
  session_id: z.string().optional().describe("可选，会复用当前 MCP 进程内的历史上下文"),
  project_context: z
    .object({
      design_system: z.string().optional(),
      existing_components: z.string().optional(),
      color_tokens: z.string().optional(),
      conventions: z.string().optional(),
      spacing_scale: z.string().optional(),
      breakpoints: z.string().optional(),
    })
    .optional()
    .describe("项目上下文，帮助重构结果与项目风格保持一致"),
};

export function registerRefactorComponent(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "refactor_component",
    "使用 Gemini AI 重构或优化已有前端组件代码",
    refactorComponentInputSchema,
    async ({ code, issues, target_pattern, session_id, project_context }) => {
      const contextBlock = project_context
        ? buildContextSection(project_context as ProjectContext)
        : "";

      const prompt = [
        "You are a senior frontend engineer refactoring production UI code.",
        contextBlock,
        "Refactor the following component code.",
        `Problems to solve: ${issues}`,
        target_pattern ? `Target pattern: ${target_pattern}` : "",
        "Requirements:",
        "- Preserve the original behavior unless the listed issues require a change",
        "- Improve readability, maintainability, and accessibility where relevant",
        "- Keep the code idiomatic for the existing framework",
        "- Return ONLY the refactored code, no explanations or markdown",
        "",
        "Code to refactor:",
        "```",
        code,
        "```",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await runGeminiTool("refactor_component", prompt, { sessionId: session_id });
      return createSessionAwareToolResult(result);
    }
  );
}
