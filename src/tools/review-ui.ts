import { z } from "zod";
import { runGeminiTool } from "../gemini-runner.js";
import { createSessionAwareToolResult } from "../tool-result.js";
import { buildContextSection, ProjectContext } from "../context-builder.js";
import { registerOptionalTaskTool } from "../task-tool.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const reviewUiInputSchema = {
  code: z.string().describe("待审查的 HTML/CSS/JSX/Vue 代码"),
  focus_areas: z
    .string()
    .optional()
    .describe("审查重点，逗号分隔，如 accessibility, performance, mobile, design-consistency"),
  session_id: z.string().optional().describe("可选，会复用当前 MCP 进程内的历史上下文"),
  project_context: z
    .object({
      design_system: z.string().optional(),
      conventions: z.string().optional(),
      color_tokens: z.string().optional(),
    })
    .optional()
    .describe("项目上下文，用于判断代码是否符合项目规范"),
};

export function registerReviewUiDesign(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "review_ui_design",
    "使用 Gemini AI 审查 UI 代码，给出可访问性、设计一致性和用户体验方面的改进建议",
    reviewUiInputSchema,
    async ({ code, focus_areas, session_id, project_context }) => {
      const contextBlock = project_context
        ? buildContextSection(project_context as ProjectContext)
        : "";

      const areas = focus_areas ?? "accessibility, design consistency, user experience, mobile responsiveness";

      const prompt = [
        "You are a senior UI/UX engineer and accessibility expert.",
        contextBlock,
        "Review the following UI code and provide actionable improvement suggestions.",
        `Focus areas: ${areas}`,
        "",
        "Code to review:",
        "```",
        code,
        "```",
        "",
        "Provide your review in this format:",
        "1. Issues found (severity: high/medium/low, description, affected line/element)",
        "2. Specific fix suggestions with code examples",
        "3. Overall score (1-10) with brief rationale",
      ]
        .filter((line) => line !== undefined)
        .join("\n");

      const result = await runGeminiTool("review_ui_design", prompt, { sessionId: session_id });
      return createSessionAwareToolResult(result);
    }
  );
}
