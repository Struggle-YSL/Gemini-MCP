export type ToolTaskSupport = "optional" | "required";

export interface ToolManifestEntry {
  name: string;
  category: "frontend-base" | "frontend-orchestrator" | "runtime";
  description: string;
  supportsSessionId: boolean;
  requiresProjectContext: boolean;
  taskSupport: ToolTaskSupport;
}

export const TOOL_MANIFEST = [
  {
    name: "generate_frontend_component",
    category: "frontend-base",
    description:
      "使用 Gemini AI 生成前端组件（React/Vue/HTML），支持注入项目设计上下文",
    supportsSessionId: true,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "create_styles",
    category: "frontend-base",
    description: "使用 Gemini AI 生成 CSS/Tailwind/SCSS 样式代码",
    supportsSessionId: true,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "review_ui_design",
    category: "frontend-base",
    description:
      "使用 Gemini AI 审查 UI 代码，给出可访问性、设计一致性和用户体验方面的改进建议",
    supportsSessionId: true,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "generate_html_structure",
    category: "frontend-base",
    description: "使用 Gemini AI 生成语义化 HTML 页面结构",
    supportsSessionId: true,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "refactor_component",
    category: "frontend-base",
    description: "使用 Gemini AI 重构或优化已有前端组件代码",
    supportsSessionId: true,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "generate_storybook_story",
    category: "frontend-base",
    description: "使用 Gemini AI 为组件生成 Storybook Story",
    supportsSessionId: true,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "convert_framework",
    category: "frontend-base",
    description: "使用 Gemini AI 在 React 与 Vue 之间转换组件代码",
    supportsSessionId: true,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "plan_frontend_solution",
    category: "frontend-orchestrator",
    description: "为 Codex 主 agent 生成结构化前端方案片段，不直接生成代码文件",
    supportsSessionId: true,
    requiresProjectContext: true,
    taskSupport: "optional",
  },
  {
    name: "implement_frontend_task",
    category: "frontend-orchestrator",
    description: "为 Codex 主 agent 生成结构化前端补丁包，供校验后落盘",
    supportsSessionId: true,
    requiresProjectContext: true,
    taskSupport: "required",
  },
  {
    name: "run_orchestrator_graph",
    category: "runtime",
    description:
      "推进主 agent 的 WorkItem DAG 状态，生成下一步 Codex 或 Gemini 动作，但不直接落盘仓库文件",
    supportsSessionId: false,
    requiresProjectContext: true,
    taskSupport: "optional",
  },
  {
    name: "run_orchestrator_loop",
    category: "runtime",
    description:
      "执行一次 orchestrator loop tick：推进 DAG、自动提交 ready 的 Gemini work item，并返回更新后的编排状态",
    supportsSessionId: false,
    requiresProjectContext: true,
    taskSupport: "optional",
  },
  {
    name: "get_orchestrator_state",
    category: "runtime",
    description: "读取已持久化的 orchestrator graph/state/summary 快照",
    supportsSessionId: false,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "get_orchestrator_summary",
    category: "runtime",
    description:
      "读取 orchestrator 的结构化最终汇总、失败补偿状态和 work item 事件轨迹",
    supportsSessionId: false,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "get_runtime_diagnostics",
    category: "runtime",
    description:
      "读取当前进程的 Gemini runtime、process-control、task execution、orchestrator runtime 和持久化诊断信息",
    supportsSessionId: false,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "get_orchestrator_resolution",
    category: "runtime",
    description:
      "读取主 agent 可消费的 orchestrator 决策包，包括 recommended actions、manual actions、已完成结果摘要和自然语言 summary",
    supportsSessionId: false,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
  {
    name: "apply_orchestrator_resolution",
    category: "runtime",
    description:
      "应用 Codex 对 orchestrator run 的决策，支持 provide-result、retry-work-item 和 mark-failed",
    supportsSessionId: false,
    requiresProjectContext: false,
    taskSupport: "optional",
  },
] as const satisfies readonly ToolManifestEntry[];

export type ToolManifestToolName = (typeof TOOL_MANIFEST)[number]["name"];

export function assertToolManifestIntegrity(): void {
  const names = TOOL_MANIFEST.map((tool) => tool.name);
  const uniqueNames = new Set(names);

  if (uniqueNames.size !== names.length) {
    const duplicates = names.filter(
      (name, index) => names.indexOf(name) !== index,
    );
    throw new Error(
      `Duplicate tool names found in tool manifest: ${duplicates.join(", ")}`,
    );
  }
}
