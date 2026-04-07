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

const generateHtmlInputSchema = {
  page_description: z
    .string()
    .describe("页面内容和目的描述，如 SaaS 产品落地页，主打 AI 代码生成功能"),
  sections: z
    .array(z.string())
    .describe(
      '页面区块列表，如 ["header", "hero", "features", "pricing", "footer"]',
    ),
  semantic_html: z
    .boolean()
    .optional()
    .describe(
      "是否使用语义化 HTML5 标签（article, section, nav 等），默认 true",
    ),
  session_id: sessionIdSchemaField,
  project_context: createOptionalProjectContextField("项目上下文"),
};

export function registerGenerateHtmlStructure(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "generate_html_structure",
    "使用 Gemini AI 生成语义化 HTML 页面结构",
    generateHtmlInputSchema,
    async ({
      page_description,
      sections,
      semantic_html = true,
      session_id,
      project_context,
    }) => {
      const contextBlock = buildOptionalProjectContextBlock(project_context);

      const prompt = buildPromptFromLines([
        "You are a senior frontend engineer specializing in semantic HTML and web accessibility.",
        contextBlock,
        `Generate the HTML structure for a page: ${page_description}`,
        `Required sections: ${sections.join(", ")}`,
        semantic_html
          ? "Use semantic HTML5 elements (header, nav, main, section, article, aside, footer)."
          : "Use div-based layout.",
        "Requirements:",
        "- Include meaningful class names for styling hooks",
        "- Add aria labels and roles where appropriate",
        "- Include placeholder content that reflects the page purpose",
        "- Return ONLY the HTML code, no explanations or markdown",
      ]);

      const result = await runGeminiTool("generate_html_structure", prompt, {
        sessionId: session_id,
      });
      return createSessionAwareToolResult(result);
    },
  );
}
