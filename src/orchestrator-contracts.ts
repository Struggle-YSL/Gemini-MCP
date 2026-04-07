import { z } from "zod";
import { requiredProjectContextSchema } from "./orchestrator-tools.js";

export const ORCHESTRATOR_SCHEMA_VERSION = "1.0" as const;

export const relatedFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export const frontendPatchFileSchema = z.object({
  path: z.string(),
  action: z.enum(["create", "update", "delete"]),
  content: z.string(),
  reason: z.string(),
});

export const planFrontendSolutionInputSchema = z.object({
  goal: z.string().describe("当前前端目标描述"),
  scope: z
    .array(z.string())
    .min(1)
    .describe("前端变更范围，如页面、组件、样式、交互"),
  constraints: z.array(z.string()).optional().describe("前端限制条件"),
  backend_contracts: z
    .array(z.string())
    .optional()
    .describe("后端接口约束或数据结构说明"),
  acceptance_criteria: z.array(z.string()).optional().describe("验收标准"),
  project_context: requiredProjectContextSchema,
  session_id: z
    .string()
    .optional()
    .describe("可选，用于多轮前端规划上下文复用"),
});

export const frontendPlanFragmentSchema = z.object({
  summary: z.string(),
  ui_changes: z.array(z.string()),
  components: z.array(z.string()),
  api_dependencies: z.array(z.string()),
  risks: z.array(z.string()),
  tests: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export const frontendPlanOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  session_id: z.string(),
  session_reused: z.boolean(),
  summary: z.string(),
  ui_changes: z.array(z.string()),
  components: z.array(z.string()),
  api_dependencies: z.array(z.string()),
  risks: z.array(z.string()),
  tests: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export const implementFrontendTaskInputSchema = z.object({
  task_goal: z.string().describe("当前前端子任务目标"),
  related_files: z
    .array(relatedFileSchema)
    .optional()
    .describe("与该任务相关的已有文件上下文"),
  allowed_paths: z
    .array(z.string())
    .min(1)
    .describe("Gemini 可返回的文件路径白名单"),
  backend_contracts: z.array(z.string()).optional().describe("前后端接口契约"),
  acceptance_criteria: z
    .array(z.string())
    .optional()
    .describe("子任务验收标准"),
  project_context: requiredProjectContextSchema,
  session_id: z
    .string()
    .optional()
    .describe("可选，用于连续前端编码上下文复用"),
});

export const frontendPatchPackageSchema = z.object({
  files: z.array(frontendPatchFileSchema),
  validation_steps: z.array(z.string()),
  open_questions: z.array(z.string()),
  risks: z.array(z.string()),
});

export const frontendPatchOutputSchema = z.object({
  schema_version: z.literal(ORCHESTRATOR_SCHEMA_VERSION),
  session_id: z.string(),
  session_reused: z.boolean(),
  task_id: z.string().optional(),
  status: z.enum(["queued", "working", "completed", "failed"]).optional(),
  progress_stage: z
    .enum([
      "queued",
      "prompting",
      "generating",
      "packaging",
      "completed",
      "failed",
    ])
    .optional(),
  files: z.array(frontendPatchFileSchema),
  validation_steps: z.array(z.string()),
  open_questions: z.array(z.string()),
  risks: z.array(z.string()),
});

export type PlanFrontendSolutionInput = z.infer<
  typeof planFrontendSolutionInputSchema
>;
export type FrontendPlanFragment = z.infer<typeof frontendPlanFragmentSchema>;
export type FrontendPlanOutput = z.infer<typeof frontendPlanOutputSchema>;
export type ImplementFrontendTaskInput = z.infer<
  typeof implementFrontendTaskInputSchema
>;
export type FrontendPatchPackage = z.infer<typeof frontendPatchPackageSchema>;
export type FrontendPatchOutput = z.infer<typeof frontendPatchOutputSchema>;
