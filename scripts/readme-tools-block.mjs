export const README_TOOL_BLOCK_START =
  "<!-- AUTO-GENERATED:TOOL-MANIFEST:START -->";
export const README_TOOL_BLOCK_END =
  "<!-- AUTO-GENERATED:TOOL-MANIFEST:END -->";

const CATEGORY_LABELS = {
  "frontend-base": "低层前端工具",
  "frontend-orchestrator": "高层前端工具",
  runtime: "编排/运行时工具",
};

const TOOL_LIST_INTRO_ANCHOR =
  "编排 / 查询 / 诊断类工具本身不接受 `session_id` 参数，但会在内部消费或产出与前端线程绑定相关的信息。编码类和长耗时场景可用 task 模式：";
const TOOL_SECTION_FIRST_HEADING = "### `generate_frontend_component`";

function listToolNames(tools) {
  if (tools.length === 0) {
    return "（无）";
  }
  return tools.map((tool) => `\`${tool.name}\``).join("、");
}

export function buildReadmeToolBlock(toolManifest) {
  const byCategory = {
    "frontend-base": toolManifest.filter(
      (tool) => tool.category === "frontend-base",
    ),
    "frontend-orchestrator": toolManifest.filter(
      (tool) => tool.category === "frontend-orchestrator",
    ),
    runtime: toolManifest.filter((tool) => tool.category === "runtime"),
  };

  const sessionAwareTools = toolManifest.filter(
    (tool) => tool.supportsSessionId,
  );
  const requiredProjectContextTools = toolManifest.filter(
    (tool) => tool.requiresProjectContext,
  );
  const requiredTaskModeTools = toolManifest.filter(
    (tool) => tool.taskSupport === "required",
  );

  const rows = toolManifest.map((tool) => {
    const category = CATEGORY_LABELS[tool.category] ?? tool.category;
    const supportsSessionId = tool.supportsSessionId ? "✅" : "❌";
    const requiresProjectContext = tool.requiresProjectContext ? "✅" : "❌";
    return `| \`${tool.name}\` | ${category} | ${supportsSessionId} | ${requiresProjectContext} | \`${tool.taskSupport}\` |`;
  });

  return [
    README_TOOL_BLOCK_START,
    "> ⚠️ 本区块由 `src/tool-manifest.ts` 自动生成，请勿手改。更新工具后运行 `npm run sync:readme-tools`。",
    "",
    `- 工具总数：${toolManifest.length}（低层前端 ${byCategory["frontend-base"].length} / 高层前端 ${byCategory["frontend-orchestrator"].length} / 编排运行时 ${byCategory.runtime.length}）`,
    `- supportsSessionId = true：${sessionAwareTools.length} 个（${listToolNames(sessionAwareTools)}）`,
    `- requiresProjectContext = true：${requiredProjectContextTools.length} 个（${listToolNames(requiredProjectContextTools)}）`,
    `- taskSupport = required：${requiredTaskModeTools.length} 个（${listToolNames(requiredTaskModeTools)}）`,
    "",
    "| 工具 | 分类 | supportsSessionId | requiresProjectContext | taskSupport |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    README_TOOL_BLOCK_END,
  ].join("\n");
}

function findBlockRange(readme) {
  const start = readme.indexOf(README_TOOL_BLOCK_START);
  const end = readme.indexOf(README_TOOL_BLOCK_END);
  if (start < 0 || end < 0 || end < start) {
    return null;
  }
  return { start, end: end + README_TOOL_BLOCK_END.length };
}

export function upsertReadmeToolBlock(readme, block) {
  const existingRange = findBlockRange(readme);
  if (existingRange) {
    return `${readme.slice(0, existingRange.start)}${block}${readme.slice(existingRange.end)}`;
  }

  const introIndex = readme.indexOf(TOOL_LIST_INTRO_ANCHOR);
  const firstToolHeadingIndex = readme.indexOf(TOOL_SECTION_FIRST_HEADING);
  if (
    introIndex < 0 ||
    firstToolHeadingIndex < 0 ||
    firstToolHeadingIndex <= introIndex
  ) {
    throw new Error(
      "Could not locate README tool block anchors for first-time insertion.",
    );
  }

  const insertPoint = introIndex + TOOL_LIST_INTRO_ANCHOR.length;
  return `${readme.slice(0, insertPoint)}\n\n${block}\n\n${readme.slice(firstToolHeadingIndex)}`;
}

export function extractReadmeToolBlock(readme) {
  const range = findBlockRange(readme);
  if (!range) {
    return null;
  }
  return readme.slice(range.start, range.end);
}
