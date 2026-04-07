import { z } from "zod";
import { runGeminiTool } from "../gemini-runner.js";
import { createSessionAwareToolResult } from "../tool-result.js";
import { registerOptionalTaskTool } from "../task-tool.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildPromptFromLines, sessionIdSchemaField } from "./frontend-tool-shared.js";

const convertFrameworkInputSchema = {
  code: z.string().describe("待转换的组件代码"),
  from: z.enum(["react", "vue"]).describe("源框架"),
  to: z.enum(["react", "vue"]).describe("目标框架"),
  session_id: sessionIdSchemaField,
};

export function registerConvertFramework(server: McpServer): void {
  registerOptionalTaskTool(
    server,
    "convert_framework",
    "使用 Gemini AI 在 React 与 Vue 之间转换组件代码",
    convertFrameworkInputSchema,
    async ({ code, from, to, session_id }) => {
      if (from === to) {
        throw new Error("`from` and `to` must be different for convert_framework");
      }

      const prompt = buildPromptFromLines(
        [
          "You are a senior frontend engineer migrating production UI code across frameworks.",
          `Convert the following ${from} code to ${to}.`,
          "Requirements:",
          "- Preserve behavior, structure, and accessibility intent",
          "- Use idiomatic patterns for the target framework",
          "- Use TypeScript in the converted result",
          "- Return ONLY the converted code, no explanations or markdown",
          "",
          "Code to convert:",
          "```",
          code,
          "```",
        ],
        { keepEmptyLines: true },
      );

      const result = await runGeminiTool("convert_framework", prompt, { sessionId: session_id });
      return createSessionAwareToolResult(result);
    }
  );
}
