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

const generateStorybookInputSchema = {
  component_code: z.string().describe("组件源码"),
  component_name: z.string().describe("组件名称"),
  stories: z
    .array(z.string())
    .describe('要生成的 Story 名称列表，如 ["Default", "Loading"]'),
  storybook_version: z
    .enum(["7", "8"])
    .optional()
    .describe("Storybook 版本，默认 8"),
  session_id: sessionIdSchemaField,
  project_context: createOptionalProjectContextField(
    "项目上下文，帮助生成结果符合现有 Storybook 和组件规范",
  ),
};

export function registerGenerateStorybookStory(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "generate_storybook_story",
    "使用 Gemini AI 为组件生成 Storybook Story",
    generateStorybookInputSchema,
    async ({
      component_code,
      component_name,
      stories,
      storybook_version = "8",
      session_id,
      project_context,
    }) => {
      const contextBlock = buildOptionalProjectContextBlock(project_context);

      const prompt = buildPromptFromLines(
        [
          "You are a senior frontend engineer maintaining a production Storybook setup.",
          contextBlock,
          `Generate a complete Storybook ${storybook_version} story file for component ${component_name}.`,
          `Required stories: ${stories.join(", ")}`,
          "Requirements:",
          "- Use TypeScript and modern CSF conventions",
          "- Infer sensible args and decorators from the component code",
          "- Keep stories useful for visual regression and interaction review",
          "- Return ONLY the story file code, no explanations or markdown",
          "",
          "Component code:",
          "```",
          component_code,
          "```",
        ],
        { keepEmptyLines: true },
      );

      const result = await runGeminiTool("generate_storybook_story", prompt, {
        sessionId: session_id,
      });
      return createSessionAwareToolResult(result);
    },
  );
}
