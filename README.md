# gemini-mcp

`gemini-mcp` 是一个面向 Codex 主 agent 的 MCP Server。它把 Gemini CLI 封装成可编排、可诊断、可持久化的前端执行层，适合在真实工程里承接页面/组件/样式任务，并把结果以结构化协议返回给主流程。

## Why gemini-mcp

- 前端任务工具化：覆盖组件生成、样式生成、UI review、框架互转、Storybook 等基础能力。
- 高层协同能力：提供前端规划和补丁包输出，便于主 agent 做验收与落盘控制。
- 编排闭环：支持 orchestrator graph/loop、状态查询、决策回填、失败补偿。
- 任务与并发治理：长任务可走 task 模式，支持排队、取消、阶段进度与并发限制。
- 持久化兜底：可用 SQLite 持久化 task/session/orchestrator；不可用时自动回退内存模式。

## Core Capabilities

- 16 个 MCP 工具（7 个低层前端工具 + 2 个高层前端工具 + 7 个运行时工具）
- `session_id` 复用（Gemini 原生会话优先，失败时回放兜底）
- `project_context` 上下文注入（高层工具强约束）
- `implement_frontend_task` 强制 task 模式（`taskSupport: required`）
- orchestrator 状态快照 / summary / resolution / diagnostics
- SQLite 恢复（服务重启后恢复中断任务与运行态）

## Prerequisites

- Node.js `>= 18`
- 推荐 Node.js `>= 22.5`（启用 `node:sqlite`；否则自动使用内存模式）
- Gemini CLI 已安装并完成认证：
  - `npm install -g @google/gemini-cli`
  - 首次运行 `gemini`

## Quick Start

### 1) npx（推荐）

```bash
npx -y gemini-mcp
```

### 2) 全局安装

```bash
npm install -g gemini-mcp
gemini-mcp
```

### 3) 仓库开发模式

```bash
npm install
npm run build
npm start
```

## MCP Config (Codex)

### npx 零安装

```toml
[mcp_servers.gemini-frontend]
command = "npx"
args = ["-y", "gemini-mcp"]
```

### 全局安装后直接启动

```toml
[mcp_servers.gemini-frontend]
command = "gemini-mcp"
args = []
```

### 项目内依赖启动

```toml
[mcp_servers.gemini-frontend]
command = "node"
args = ["./node_modules/gemini-mcp/dist/cli.js"]
```

## High-Level Usage Model

- Codex 主 agent 负责目标拆解、验收标准、结果汇总与最终落盘。
- Gemini 负责前端规划片段和前端补丁包生成，不直接写仓库文件。
- 高层前端工具必须传 `project_context`，且至少包含以下任意一项非空字符串：
  - `design_system`
  - `existing_components`
  - `conventions`
- `implement_frontend_task` 还必须提供 `allowed_paths`，服务端会做路径白名单校验。

## Tool Catalog

编排 / 查询 / 诊断类工具本身不接受 `session_id` 参数，但会在内部消费或产出与前端线程绑定相关的信息。编码类和长耗时场景可用 task 模式：

<!-- AUTO-GENERATED:TOOL-MANIFEST:START -->
> ⚠️ 本区块由 `src/tool-manifest.ts` 自动生成，请勿手改。更新工具后运行 `npm run sync:readme-tools`。

- 工具总数：16（低层前端 7 / 高层前端 2 / 编排运行时 7）
- supportsSessionId = true：9 个（`generate_frontend_component`、`create_styles`、`review_ui_design`、`generate_html_structure`、`refactor_component`、`generate_storybook_story`、`convert_framework`、`plan_frontend_solution`、`implement_frontend_task`）
- requiresProjectContext = true：4 个（`plan_frontend_solution`、`implement_frontend_task`、`run_orchestrator_graph`、`run_orchestrator_loop`）
- taskSupport = required：1 个（`implement_frontend_task`）

| 工具 | 分类 | supportsSessionId | requiresProjectContext | taskSupport |
| --- | --- | --- | --- | --- |
| `generate_frontend_component` | 低层前端工具 | ✅ | ❌ | `optional` |
| `create_styles` | 低层前端工具 | ✅ | ❌ | `optional` |
| `review_ui_design` | 低层前端工具 | ✅ | ❌ | `optional` |
| `generate_html_structure` | 低层前端工具 | ✅ | ❌ | `optional` |
| `refactor_component` | 低层前端工具 | ✅ | ❌ | `optional` |
| `generate_storybook_story` | 低层前端工具 | ✅ | ❌ | `optional` |
| `convert_framework` | 低层前端工具 | ✅ | ❌ | `optional` |
| `plan_frontend_solution` | 高层前端工具 | ✅ | ✅ | `optional` |
| `implement_frontend_task` | 高层前端工具 | ✅ | ✅ | `required` |
| `run_orchestrator_graph` | 编排/运行时工具 | ❌ | ✅ | `optional` |
| `run_orchestrator_loop` | 编排/运行时工具 | ❌ | ✅ | `optional` |
| `get_orchestrator_state` | 编排/运行时工具 | ❌ | ❌ | `optional` |
| `get_orchestrator_summary` | 编排/运行时工具 | ❌ | ❌ | `optional` |
| `get_runtime_diagnostics` | 编排/运行时工具 | ❌ | ❌ | `optional` |
| `get_orchestrator_resolution` | 编排/运行时工具 | ❌ | ❌ | `optional` |
| `apply_orchestrator_resolution` | 编排/运行时工具 | ❌ | ❌ | `optional` |
<!-- AUTO-GENERATED:TOOL-MANIFEST:END -->

## Tool Reference

### `generate_frontend_component`

生成 React / Vue / HTML 组件代码，适用于新组件草稿和快速原型。

关键入参：`component_name`、`framework`、`description`，可选 `props`、`style_preference`、`session_id`、`project_context`。

### `create_styles`

生成 CSS / Tailwind / SCSS 样式代码，支持响应式约束和设计令牌输入。

关键入参：`element_description`、`style_type`，可选 `design_tokens`、`responsive`、`session_id`、`project_context`。

### `review_ui_design`

审查 HTML/CSS/JSX/Vue 代码，输出问题列表、修复建议和总体评分。

关键入参：`code`，可选 `focus_areas`、`session_id`、`project_context`。

### `generate_html_structure`

生成语义化页面结构（header/main/section/footer 等），用于页面骨架搭建。

关键入参：`page_description`、`sections`，可选 `semantic_html`、`session_id`、`project_context`。

### `refactor_component`

对已有组件做结构与可维护性重构，默认尽量保持行为不变。

关键入参：`code`、`issues`，可选 `target_pattern`、`session_id`、`project_context`。

### `generate_storybook_story`

基于组件代码生成 Storybook Story（CSF + TypeScript），用于可视回归与交互校验。

关键入参：`component_code`、`component_name`、`stories`，可选 `storybook_version`、`session_id`、`project_context`。

### `convert_framework`

在 React 和 Vue 之间转换组件代码（要求 `from` 与 `to` 不同）。

关键入参：`code`、`from`、`to`，可选 `session_id`。

### `plan_frontend_solution`

生成结构化前端方案片段，不直接产出落盘文件。适合计划阶段与方案评审。

关键入参：`goal`、`scope`、`project_context`，可选 `constraints`、`backend_contracts`、`acceptance_criteria`、`session_id`。

### `implement_frontend_task`

生成结构化前端补丁包（`files[]` + 校验步骤 + 风险），供 Codex 校验后落盘。该工具必须以 task 模式调用。

关键入参：`task_goal`、`allowed_paths`、`project_context`，可选 `related_files`、`backend_contracts`、`acceptance_criteria`、`session_id`。

### `run_orchestrator_graph`

单步推进 WorkItem DAG，生成下一步动作（Codex action / Gemini action），可选持久化快照。

关键入参：`graph`、`project_context`，可选 `orchestrator_id`、`state`、`work_item_inputs`、`persist`、`load_if_exists`。

### `run_orchestrator_loop`

执行一次 loop tick：推进 DAG，并按条件自动提交 ready 的 Gemini work items。

关键入参：`graph`、`project_context`，可选 `orchestrator_id`、`auto_submit_gemini`、`max_submissions`、`persist`、`load_if_exists`。

### `get_orchestrator_state`

读取持久化 orchestrator 快照（graph/state/summary/runtime/context）。

关键入参：`orchestrator_id`。

### `get_orchestrator_summary`

读取结构化最终汇总与事件轨迹，适合复盘 run 结果与失败补偿状态。

关键入参：`orchestrator_id`。

### `get_runtime_diagnostics`

读取当前进程运行态诊断：Gemini runtime、任务队列、失败聚合、orchestrator runtime、process-control、持久化模式。

关键入参：空对象 `{}`。

### `get_orchestrator_resolution`

读取主 agent 可消费的决策包（recommended/manual actions、completed results、自然语言摘要）。

关键入参：`orchestrator_id`。

### `apply_orchestrator_resolution`

写回 Codex 决策（`provide-result` / `retry-work-item` / `mark-failed`），必要时重新激活后台 runtime。

关键入参：`orchestrator_id`、`resolutions`。

## Session Reuse

- 支持 `session_id` 的工具会在 `structuredContent` 中返回：
  - `session_id`
  - `session_reused`
- 优先使用 Gemini 原生会话恢复；若恢复失败且进程内缓存存在，则退回到回放模式。
- 若原生恢复失败且缓存不存在，会抛出会话错误并终止该次调用。

## Runtime & Persistence

- 默认持久化路径：`.gemini-mcp/state.sqlite`（可通过环境变量覆盖）
- 若 `node:sqlite` 不可用，自动回退为内存模式（功能可用，但不跨进程持久化）
- 服务重启后可恢复中断 task，并清理遗留队列消息
- 可通过 `get_runtime_diagnostics` 查看当前是 `sqlite` 还是 `memory`

## Environment Variables

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `GEMINI_PATH` | 空 | 指定 Gemini CLI 可执行文件绝对路径 |
| `GEMINI_MCP_DB_PATH` | `.gemini-mcp/state.sqlite` | SQLite 文件路径 |
| `GEMINI_MCP_MAX_FRONTEND_TASKS` | `2` | `implement_frontend_task` 并发槽位 |
| `GEMINI_MCP_MAX_ACTIVE_ORCHESTRATORS` | `2` | 后台并行 orchestrator run 上限 |
| `GEMINI_MCP_ORCHESTRATOR_TICK_MS` | `1500` | orchestrator loop tick 周期（毫秒） |
| `GEMINI_MCP_ORCHESTRATOR_MAX_GEMINI_RETRIES` | `2` | Gemini work item 自动重试上限 |
| `GEMINI_MCP_PROCESS_TERMINATION_GRACE_MS` | `1500` | 子进程优雅终止等待时间（毫秒） |
| `GEMINI_MCP_PROCESS_TERMINATION_FORCE_WAIT_MS` | `1000` | 强制终止后等待回收时间（毫秒） |
| `GEMINI_MCP_LOG_LEVEL` | `info` | 日志级别：`info` / `warn` / `error` |

## CLI

```bash
gemini-mcp --help
gemini-mcp --version
gemini-mcp --skip-gemini-check
```

## Development

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
npm run sync:readme-tools
npm run check:doc-sync
npm run check:npm-package
npm run check:v31-smoke
npm run release:check
```

## CI

GitHub Actions 会执行：

- quality：`format:check`、`lint`、`typecheck`、`test`、`check:doc-sync`、`check:npm-package`
- v3.1 platform smoke：`ubuntu-latest` / `macos-latest` / `windows-latest` 三平台烟测

## Troubleshooting

### Gemini CLI not found

- 安装：`npm install -g @google/gemini-cli`
- 完成认证：`gemini`
- 或设置 `GEMINI_PATH` 指向可执行文件

### MCP 调用超时

- 对长耗时前端任务优先使用 task 模式
- 提高调用方超时设置（建议 `>= 240000ms`）
- 检查代理环境变量是否传递到 MCP 进程（`HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`）

### 持久化没有生效

- 使用 Node.js `>= 22.5`
- 检查 `GEMINI_MCP_DB_PATH` 是否可写
- 通过 `get_runtime_diagnostics` 查看 `persistence.mode`

## Contributing

欢迎提交 issue / PR。涉及工具 schema、工具清单或 README 工具区块的修改，请同时执行：

```bash
npm run build
npm run sync:readme-tools
npm run check:doc-sync
```

## License

当前仓库尚未声明开源许可证（`package.json` 未设置 `license` 字段，仓库根目录暂无 LICENSE 文件）。
