import { z } from "zod";
import { runGeminiTool } from "../gemini-runner.js";
import { createSessionAwareToolResult } from "../tool-result.js";
import { registerOptionalTaskTool } from "../task-tool.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildOptionalProjectContextBlock,
  buildPromptFromLines,
  createOptionalProjectContextField,
  sessionIdSchemaField,
} from "./frontend-tool-shared.js";

const refactorComponentInputSchema = {
  code: z.string().describe("待重构的组件代码"),
  issues: z.string().describe("问题描述，如 prop drilling, no memoization"),
  target_pattern: z.string().optional().describe("目标模式，如 compound component"),
  session_id: sessionIdSchemaField,
  project_context: createOptionalProjectContextField(
    "项目上下文，帮助重构结果与项目风格保持一致"
  ),
};

export function registerRefactorComponent(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "refactor_component",
    "使用 Gemini AI 重构或优化已有前端组件代码",
    refactorComponentInputSchema,
    async ({ code, issues, target_pattern, session_id, project_context }) => {
      const contextBlock = buildOptionalProjectContextBlock(project_context);

      const prompt = buildPromptFromLines(
        [
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
        ],
        { keepEmptyLines: true },
      );

      const result = await runGeminiTool("refactor_component", prompt, { sessionId: session_id });
      return createSessionAwareToolResult(result);
    }
  );
}
