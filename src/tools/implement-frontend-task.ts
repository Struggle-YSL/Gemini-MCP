import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runGeminiTool } from "../gemini-runner.js";
import { buildContextSection, ProjectContext } from "../context-builder.js";
import {
  OptionalTaskToolContext,
  registerRequiredTaskTool,
  type TaskToolExecutionOptions,
} from "../task-tool.js";
import {
  assertPathsWithinAllowList,
  createStructuredToolResult,
  parseStructuredResult,
  validateAllowedPaths,
} from "../orchestrator-tools.js";
import {
  frontendPatchOutputSchema,
  frontendPatchPackageSchema,
  implementFrontendTaskInputSchema,
  ORCHESTRATOR_SCHEMA_VERSION,
  type FrontendPatchPackage,
  type ImplementFrontendTaskInput,
} from "../orchestrator-contracts.js";
import { RUNTIME_CONFIG } from "../config.js";

type RunGeminiToolFn = typeof runGeminiTool;

export interface ImplementFrontendTaskDependencies {
  runGeminiToolFn?: RunGeminiToolFn;
}

export function getImplementFrontendTaskExecutionOptions(): TaskToolExecutionOptions {
  return {
    mode: "queued",
    queueKey: "frontend-implementation",
    concurrencyLimit: RUNTIME_CONFIG.maxFrontendTasks,
  };
}

function formatRelatedFiles(
  relatedFiles?: ImplementFrontendTaskInput["related_files"],
): string {
  if (!relatedFiles?.length) {
    return "";
  }

  return relatedFiles
    .map((file) => {
      return [`File: ${file.path}`, "```", file.content, "```"].join("\n");
    })
    .join("\n\n");
}

function buildCompletedPatchResult(
  result: Awaited<ReturnType<typeof runGeminiTool>>,
  patchPackage: FrontendPatchPackage,
  taskId?: string,
) {
  return createStructuredToolResult({
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    session_id: result.sessionId,
    session_reused: result.sessionReused,
    task_id: taskId,
    status: "completed" as const,
    progress_stage: "completed" as const,
    ...patchPackage,
  });
}

export async function executeImplementFrontendTask(
  args: ImplementFrontendTaskInput,
  context?: OptionalTaskToolContext,
  dependencies: ImplementFrontendTaskDependencies = {},
): Promise<CallToolResult> {
  const {
    task_goal,
    related_files,
    allowed_paths,
    backend_contracts,
    acceptance_criteria,
    project_context,
    session_id,
  } = args;

  const runGemini = dependencies.runGeminiToolFn ?? runGeminiTool;

  await context?.reportProgressStage?.(
    "prompting",
    "Building Gemini coding prompt",
  );

  const normalizedAllowedPaths = validateAllowedPaths(allowed_paths);
  const contextBlock = buildContextSection(project_context as ProjectContext);
  const relatedFilesBlock = formatRelatedFiles(related_files);
  const prompt = [
    "You are the frontend coding executor for a Codex orchestrator.",
    contextBlock,
    `Task goal: ${task_goal}`,
    `Allowed paths: ${normalizedAllowedPaths.join(", ")}`,
    backend_contracts?.length
      ? `Backend contracts: ${backend_contracts.join(" | ")}`
      : "",
    acceptance_criteria?.length
      ? `Acceptance criteria: ${acceptance_criteria.join(" | ")}`
      : "",
    relatedFilesBlock ? "Related files:" : "",
    relatedFilesBlock,
    "Return exactly one JSON object with these keys:",
    '{"files":[{"path":"","action":"create","content":"","reason":""}],"validation_steps":[],"open_questions":[],"risks":[]}',
    "Rules:",
    "- Do not include markdown fences or explanations.",
    "- Only return file paths that match allowed_paths.",
    "- files.content must contain the full target file content for create/update actions.",
    "- For delete actions, set content to an empty string.",
  ]
    .filter(Boolean)
    .join("\n");

  await context?.reportProgressStage?.(
    "generating",
    "Running Gemini for structured patch generation",
  );
  context?.throwIfAborted?.();
  const result = await runGemini("implement_frontend_task", prompt, {
    sessionId: session_id,
    signal: context?.signal,
  });

  await context?.reportProgressStage?.(
    "packaging",
    "Validating and packaging Gemini patch output",
  );
  const patchPackage = parseStructuredResult(
    "implement_frontend_task",
    result.text,
    frontendPatchPackageSchema,
  );

  assertPathsWithinAllowList(
    patchPackage.files.map((file) => file.path),
    normalizedAllowedPaths,
  );

  return buildCompletedPatchResult(result, patchPackage, context?.taskId);
}

export function registerImplementFrontendTask(server: McpServer): void {
  registerRequiredTaskTool(
    server,
    "implement_frontend_task",
    "为 Codex 主 agent 生成结构化前端补丁包，供校验后落盘",
    implementFrontendTaskInputSchema.shape,
    async (args, context) => {
      return await executeImplementFrontendTask(
        args as ImplementFrontendTaskInput,
        context,
      );
    },
    {
      outputSchema: frontendPatchOutputSchema.shape,
      execution: getImplementFrontendTaskExecutionOptions(),
    },
  );
}
