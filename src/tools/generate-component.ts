import { z } from "zod";
import { runGeminiTool } from "../gemini-runner.js";
import { createSessionAwareToolResult } from "../tool-result.js";
import { buildContextSection, ProjectContext } from "../context-builder.js";
import { registerOptionalTaskTool } from "../task-tool.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const generateComponentInputSchema = z.object({
  component_name: z.string().describe("组件名称，如 Button、UserCard"),
  framework: z.enum(["react", "vue", "html"]).describe("目标框架"),
  description: z.string().describe("组件功能和外观的详细描述"),
  props: z.string().optional().describe("组件属性定义，如 variant: primary|secondary, size: sm|md|lg"),
  style_preference: z.string().optional().describe("样式方案，如 Tailwind CSS、CSS Modules、styled-components"),
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
    .describe("项目上下文，注入后可使生成代码与项目风格保持一致"),
});

export function registerGenerateComponent(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "generate_frontend_component",
    "使用 Gemini AI 生成前端组件（React/Vue/HTML），支持注入项目设计上下文",
    generateComponentInputSchema.shape,
    async ({ component_name, framework, description, props, style_preference, session_id, project_context }) => {
      const contextBlock = project_context
        ? buildContextSection(project_context as ProjectContext)
        : "";

      const prompt = [
        "You are a senior frontend engineer working on a real production project.",
        contextBlock,
        `Generate a ${framework} component named ${component_name}.`,
        `Description: ${description}`,
        props ? `Props: ${props}` : "",
        style_preference ? `Styling approach: ${style_preference}` : "",
        "Requirements:",
        "- Write complete, production-ready code",
        "- Use TypeScript if framework is react or vue",
        "- Follow accessibility best practices",
        "- Return ONLY the component code, no explanations or markdown",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await runGeminiTool("generate_frontend_component", prompt, { sessionId: session_id });
      return createSessionAwareToolResult(result);
    }
  );
}
