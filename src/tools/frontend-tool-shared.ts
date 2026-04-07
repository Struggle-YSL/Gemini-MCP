import { z } from "zod";
import { buildContextSection, type ProjectContext } from "../context-builder.js";
import { projectContextSchema } from "../orchestrator-tools.js";

export const sessionIdSchemaField = z
  .string()
  .optional()
  .describe("可选，会复用当前 MCP 进程内的历史上下文");

export function createOptionalProjectContextField(description: string) {
  return projectContextSchema.optional().describe(description);
}

export function buildOptionalProjectContextBlock(
  projectContext?: ProjectContext,
): string {
  return projectContext ? buildContextSection(projectContext) : "";
}

export function buildPromptFromLines(
  lines: Array<string | undefined | null | false>,
  options?: { keepEmptyLines?: boolean },
): string {
  if (options?.keepEmptyLines) {
    return lines
      .filter((line): line is string => typeof line === "string")
      .join("\n");
  }

  return lines
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}
