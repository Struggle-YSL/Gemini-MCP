# Agent Instructions

## 项目定位

- 本仓库是 `gemini-frontend` MCP Server：将 Gemini CLI 封装为 MCP 服务，供 Codex 主 agent 调用处理前端任务。
- 当前主线已完成 v2.6 的主 agent 协同闭环，能力覆盖：
  - 7 个低层前端工具
  - 9 个高层编排/运行时工具
  - `session_id` 复用
  - task 模式
  - orchestrator graph / loop / summary / resolution / diagnostics
  - SQLite 持久化（不可用时自动回退内存）
- 下一阶段重点：
  - v3.0：npm 安装分发（Windows 优先）
  - v3.1：Linux / macOS 端到端验证与平台兜底

## 事实来源优先级

在回答、规划或实现前，优先参考以下文件，而不是凭记忆假设：

1. `README.md`
2. `src/tool-manifest.ts`
3. `src/index.ts`
4. `docs/plans/gemini-mcp-server.md`
5. `docs/plans/2026-03-20-codex-gemini-orchestrator-design.md`
6. `docs/plans/2026-03-20-codex-gemini-orchestrator-implementation-plan.md`
7. `docs/plans/2026-03-20-codex-gemini-tool-schemas.md`
8. `docs/plans/upgrade-roadmap.md`

若文档与代码不一致，以当前代码注册结果和 `README.md` 为准，并在最终说明中明确指出差异。

## 目标角色

- Codex 是主 agent，负责：
  - 需求理解
  - 任务编排
  - 后端方案与后端实现
  - 协议设计、运行时逻辑、持久化、校验、测试
  - 结果汇总与最终输出
- Gemini 是前端执行器，负责：
  - 前端规划子任务
  - 前端编码子任务
  - 页面/组件/样式/UI review 相关内容生成
- 最终计划与最终结果只能由 Codex 汇总输出。

## 工具使用规则

### 前端任务（强制走 MCP）

以下任务必须使用 `gemini-frontend` MCP 工具，禁止 Codex 直接生成最终前端代码或 UI 方案：

- HTML 页面、页面骨架、语义化结构
- CSS / SCSS / Tailwind / 样式代码
- React / Vue 组件
- 组件重构建议
- Storybook Story
- React / Vue 框架互转
- UI 审查和改进建议
- 前端规划片段
- 前端补丁包

对应工具：

- 生成组件 → `generate_frontend_component`
- 生成样式 → `create_styles`
- 审查 UI → `review_ui_design`
- 生成页面骨架 → `generate_html_structure`
- 组件重构 → `refactor_component`
- 生成 Storybook → `generate_storybook_story`
- 框架互转 → `convert_framework`
- 生成前端规划片段 → `plan_frontend_solution`
- 生成前端补丁包 → `implement_frontend_task`

调用所有支持 `project_context` 的前端 planning / coding 工具时，都应传入 `project_context`；其中 `plan_frontend_solution`、`implement_frontend_task`、`run_orchestrator_graph`、`run_orchestrator_loop` 为协议必填，且 `design_system` / `existing_components` / `conventions` 至少一项必须为非空字符串。`generate_frontend_component`、`create_styles`、`review_ui_design`、`generate_html_structure` 在本仓库协同中也应显式提供。至少说明：

- `design_system`
- `existing_components`
- `conventions`

如项目已有信息充分，建议一并传入：

- `color_tokens`
- `spacing_scale`
- `breakpoints`

### 后端与基础设施任务（Codex 自行处理）

以下任务由 Codex 直接实现，不走 Gemini 前端工具：

- API、数据库、算法、服务逻辑
- MCP 工具注册与 server wiring
- task / session / persistence / runtime 管理
- orchestrator 状态机、resolution、validator、diagnostics
- 测试、构建、发布相关逻辑
- README、方案文档、AGENTS 文档等非前端产物

## 主 Agent 协同规则

### 计划阶段

- Codex 先输出后端/运行时/协议计划片段。
- 若需求包含页面、组件、样式、交互、视觉结构、UI review 等前端范围，Codex 必须调用 Gemini 生成前端计划片段。
- 当前高层规划工具优先使用：`plan_frontend_solution`
- 最终计划必须由 Codex 汇总，不能直接转发 Gemini 原始结果作为最终答复。

### 编码阶段

- 命中前端文件、页面、组件、样式或 UI 调整的任务，优先路由给 Gemini。
- 命中 API、数据库、服务逻辑、算法、运行时调度、持久化和校验逻辑的任务，由 Codex 自行处理。
- 当前高层前端编码工具优先使用：`implement_frontend_task`
- `implement_frontend_task` 必须提供：
  - `project_context`
  - `allowed_paths`
- 前端长任务必须优先使用 task 模式，避免同步阻塞主流程。
- 小而局部的前端问题可使用低层工具；涉及多文件补丁、文件落盘候选、验收标准时，优先使用高层工具。

### 编排阶段

- 若任务需要多个 work item、依赖关系、状态推进、自动提交 Gemini 子任务或恢复运行态，优先使用：
  - `run_orchestrator_graph`
  - `run_orchestrator_loop`
  - `get_orchestrator_state`
  - `get_orchestrator_summary`
  - `get_orchestrator_resolution`
  - `apply_orchestrator_resolution`
  - `get_runtime_diagnostics`
- 对多步骤前后端协同任务，优先让 Codex 持有 DAG/状态，Gemini 只负责前端节点执行。

### 集成阶段

- Gemini 返回的结果必须先由 Codex 校验。
- Gemini 不直接写仓库文件；是否落盘、如何落盘、是否接受补丁，由 Codex 决定。
- Codex 在落盘前应检查：
  - schema 是否完整
  - 路径是否命中 `allowed_paths`
  - 是否与现有改动冲突
  - 是否满足验收标准
- 最终结果汇总只能由 Codex 输出。

## 工具选型准则

### 低层前端工具

适用场景：单次、局部、无复杂编排的前端子任务。

- `generate_frontend_component`
- `create_styles`
- `review_ui_design`
- `generate_html_structure`
- `refactor_component`
- `generate_storybook_story`
- `convert_framework`

### 高层前端工具

适用场景：Codex 需要结构化规划结果或结构化补丁包。

- `plan_frontend_solution`：计划阶段生成前端方案片段，不直接生成代码文件
- `implement_frontend_task`：编码阶段生成结构化补丁包，适合多文件前端变更

### 编排工具

适用场景：需要 DAG、重试、后台推进、恢复、最终汇总、决策回填。

- `run_orchestrator_graph`
- `run_orchestrator_loop`
- `get_orchestrator_state`
- `get_orchestrator_summary`
- `get_runtime_diagnostics`
- `get_orchestrator_resolution`
- `apply_orchestrator_resolution`

## 仓库结构与修改落点

优先遵循现有目录职责，不随意打散：

- `src/index.ts`：MCP 服务入口、工具注册、runtime 装配
- `src/gemini-runner.ts`：Gemini CLI 运行时入口（路径发现、auth preflight、session/retry、子进程执行）
- `src/gemini-runner-*.ts`：runner 子模块（errors/proxy/session/logging/auth/process）
- `src/task-tool.ts`：task 模块入口（注册/提交与执行状态导出）
- `src/task-tool-*.ts` / `src/task-execution.ts`：task 模式封装子模块与执行槽位（含 scheduling 复用边界）
- `src/process-control.ts`：Gemini 子进程终止与回收
- `src/context-builder.ts`：项目上下文格式化
- `src/session-store.ts`：session 存储抽象
- `src/orchestrator-*.ts`：编排协议、状态、runtime、summary、validator、resolution、diagnostics
- `src/orchestrator-runtime-manager*.ts`：runtime manager 入口与子模块（types/helpers/process/events/retry）
- `src/sqlite-persistence.ts`：SQLite 持久化入口（runtime 组装）
- `src/sqlite-persistence-*.ts` / `src/sqlite-*-store.ts` / `src/sqlite-*-helpers.ts`：SQLite 持久化子模块（schema/recovery/task/message/session/orchestrator 与 store 内部复用边界）
- `src/tools/*.ts`：MCP 工具定义与注册
- `test/*.test.mjs`：对应模块测试

新增能力时优先复用现有抽象，不要把 orchestrator 逻辑重新塞回单个 tool 文件中。

## 开发与验证规则

- 修改 TypeScript 源码后，至少执行：
  - `npm run build`
  - `npm test`
- 若仅做静态接口调整，至少执行：
  - `npm run typecheck`
- 若改动了 orchestrator、runtime、persistence、resolution、validator，优先补或改对应 `test/*.test.mjs`。
- 若改动了工具 schema、调用约束或协同流程，同时更新：
  - `src/tool-manifest.ts`
  - 运行 `npm run sync:readme-tools`（刷新 README 自动生成工具区块）
  - 运行 `npm run check:doc-sync`（校验 README 与 manifest/章节一致）
  - `README.md`（非自动生成区块的说明、示例）
  - `docs/plans` 下相关文档
  - `AGENTS.md`（如协作规则被改变）

## 关键约束

- 不要绕过 `project_context` 要求。
- 不要让 Gemini 结果直接落盘。
- 不要在长耗时前端任务上优先使用同步阻塞调用。
- 不要把后端/运行时逻辑错误地外包给 Gemini。
- 不要忽略持久化可选性：Node / 环境不满足时，系统可能回退到 in-memory 模式。
- 不要在文档中只写“支持 orchestrator”；应说明具体工具名和调用边界。
- 不要手改 README 中 `AUTO-GENERATED:TOOL-MANIFEST` 区块；应通过 `npm run sync:readme-tools` 生成。

## 常用决策模板

- 仅需一个组件/样式/UI 审查 → 走低层前端工具
- 需要结构化前端方案 → `plan_frontend_solution`
- 需要结构化前端补丁包 → `implement_frontend_task`
- 需要多 work item 协同、状态恢复、后台推进 → orchestrator 工具链
- 需要修改 MCP server、运行时、持久化、测试 → Codex 直接实现

## 关联文档

详见：

- `README.md`
- `docs/plans/gemini-mcp-server.md`
- `docs/plans/2026-03-20-codex-gemini-orchestrator-design.md`
- `docs/plans/2026-03-20-codex-gemini-orchestrator-implementation-plan.md`
- `docs/plans/2026-03-20-codex-gemini-tool-schemas.md`
- `docs/plans/upgrade-roadmap.md`
