import { z } from "zod";
import { runGeminiTool } from "../gemini-runner.js";
import { createSessionAwareToolResult } from "../tool-result.js";
import { buildContextSection, ProjectContext } from "../context-builder.js";
import { registerOptionalTaskTool } from "../task-tool.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const createStylesInputSchema = {
  element_description: z.string().describe("要样式化的元素描述，如 主导航栏、卡片组件悬停效果"),
  style_type: z.enum(["css", "tailwind", "scss"]).describe("样式方案"),
  design_tokens: z.string().optional().describe("设计令牌，如颜色、字体、圆角变量"),
  responsive: z.boolean().optional().describe("是否生成响应式样式，默认 false"),
  session_id: z.string().optional().describe("可选，会复用当前 MCP 进程内的历史上下文"),
  project_context: z
    .object({
      color_tokens: z.string().optional(),
      spacing_scale: z.string().optional(),
      breakpoints: z.string().optional(),
      conventions: z.string().optional(),
    })
    .optional()
    .describe("项目上下文"),
};

export function registerCreateStyles(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "create_styles",
    "使用 Gemini AI 生成 CSS/Tailwind/SCSS 样式代码",
    createStylesInputSchema,
    async ({ element_description, style_type, design_tokens, responsive, session_id, project_context }) => {
      const contextBlock = project_context
        ? buildContextSection(project_context as ProjectContext)
        : "";

      const prompt = [
        "You are a senior frontend engineer specializing in CSS and design systems.",
        contextBlock,
        `Generate ${style_type} styles for: ${element_description}`,
        design_tokens ? `Design tokens available: ${design_tokens}` : "",
        responsive ? "Include responsive styles for mobile, tablet, and desktop." : "",
        "Requirements:",
        "- Write clean, maintainable styles",
        "- Use CSS custom properties where applicable",
        "- Return ONLY the style code, no explanations or markdown",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await runGeminiTool("create_styles", prompt, { sessionId: session_id });
      return createSessionAwareToolResult(result);
    }
  );
}
