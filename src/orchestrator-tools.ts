import path from "node:path";
import { z } from "zod";

export const projectContextSchema = z.object({
  design_system: z.string().optional(),
  existing_components: z.string().optional(),
  color_tokens: z.string().optional(),
  conventions: z.string().optional(),
  spacing_scale: z.string().optional(),
  breakpoints: z.string().optional(),
});

function hasNonEmptyValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export const requiredProjectContextSchema = projectContextSchema
  .superRefine((value, ctx) => {
    const hasCoreContext =
      hasNonEmptyValue(value.design_system)
      || hasNonEmptyValue(value.existing_components)
      || hasNonEmptyValue(value.conventions);

    if (!hasCoreContext) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "project_context 至少需要提供 design_system / existing_components / conventions 之一的非空值。",
      });
    }
  })
  .describe(
    "项目上下文，编排类前端工具必填，且至少提供 design_system / existing_components / conventions 之一"
  );

export function extractStructuredJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    throw new Error("Gemini returned empty output while JSON was expected.");
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Gemini returned non-JSON output: ${raw}`);
  }
}

export function parseStructuredResult<T>(
  toolName: string,
  raw: string,
  schema: z.ZodType<T>
): T {
  const parsed = extractStructuredJson(raw);
  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `${toolName} returned invalid structured JSON: ${result.error.message}`
    );
  }

  return result.data;
}

export function createStructuredToolResult<T extends Record<string, unknown>>(
  payload: T
) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, "/").trim();

  if (!normalized) {
    throw new Error("Path must not be empty.");
  }

  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/")) {
    throw new Error(`Absolute paths are not allowed: ${input}`);
  }

  const resolved = path.posix.normalize(normalized);
  if (resolved === "." || resolved.startsWith("../") || resolved.includes("/../")) {
    throw new Error(`Path escapes the workspace root: ${input}`);
  }

  return resolved;
}

function escapeRegex(input: string): string {
  return input.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
  const normalized = normalizeRelativePath(glob);
  let pattern = escapeRegex(normalized);

  pattern = pattern.replace(/\*\*/g, "__DOUBLE_STAR__");
  pattern = pattern.replace(/\*/g, "[^/]*");
  pattern = pattern.replace(/__DOUBLE_STAR__/g, ".*");

  return new RegExp(`^${pattern}$`);
}

export function validateAllowedPaths(paths: string[]): string[] {
  if (paths.length === 0) {
    throw new Error("allowed_paths must contain at least one path pattern.");
  }

  return paths.map((item) => normalizeRelativePath(item));
}

export function assertPathsWithinAllowList(
  filePaths: string[],
  allowedPaths: string[]
): void {
  const normalizedAllowList = validateAllowedPaths(allowedPaths);
  const matchers = normalizedAllowList.map((item) => globToRegex(item));

  for (const filePath of filePaths) {
    const normalizedFilePath = normalizeRelativePath(filePath);
    const matched = matchers.some((matcher) => matcher.test(normalizedFilePath));

    if (!matched) {
      throw new Error(
        `File path '${normalizedFilePath}' is outside allowed_paths: ${normalizedAllowList.join(", ")}`
      );
    }
  }
}
