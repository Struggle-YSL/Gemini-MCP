import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getGeminiErrorMeta } from "./gemini-runner.js";

export const structuredErrorSchema = z.object({
  kind: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export const taskFailureStructuredContentSchema = z.object({
  status: z.literal("failed"),
  progress_stage: z.literal("failed"),
  error: structuredErrorSchema,
});

export type StructuredError = z.infer<typeof structuredErrorSchema>;
export type TaskFailureStructuredContent = z.infer<
  typeof taskFailureStructuredContentSchema
>;

function normalizeErrorMessage(message: string): string {
  const normalized = message.trim();
  return normalized.length > 0 ? normalized : "Unknown error.";
}

export function normalizeError(error: unknown): StructuredError {
  const structured = structuredErrorSchema.safeParse(error);
  if (structured.success) {
    return structured.data;
  }

  const meta = getGeminiErrorMeta(error);

  return structuredErrorSchema.parse({
    kind: meta.kind,
    message: normalizeErrorMessage(meta.message),
    retryable: meta.retryable === true,
  });
}

export function buildTaskFailureStructuredContent(
  error: unknown,
): TaskFailureStructuredContent {
  return taskFailureStructuredContentSchema.parse({
    status: "failed",
    progress_stage: "failed",
    error: normalizeError(error),
  });
}

export function createTaskFailureResult(error: unknown): CallToolResult {
  const structuredContent = buildTaskFailureStructuredContent(error);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
    isError: true,
  };
}

function tryParseTaskFailure(
  value: unknown,
): TaskFailureStructuredContent | null {
  const parsed = taskFailureStructuredContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function extractTaskFailureError(
  result: unknown,
): StructuredError | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const fromStructured = tryParseTaskFailure(
    (result as { structuredContent?: unknown }).structuredContent,
  );
  if (fromStructured) {
    return fromStructured.error;
  }

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    if ((block as { type?: unknown }).type !== "text") {
      continue;
    }

    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string" || text.trim().length === 0) {
      continue;
    }

    try {
      const parsedJson = JSON.parse(text);
      const parsedFailure = tryParseTaskFailure(parsedJson);
      if (parsedFailure) {
        return parsedFailure.error;
      }
    } catch {
      // ignore invalid JSON text chunks
    }
  }

  return undefined;
}
