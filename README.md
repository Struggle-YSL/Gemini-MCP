# Gemini MCP Server

将 Gemini CLI 封装为 MCP 服务，供 Codex 调用处理前端任务。

## 快速开始

```bash
npm install
npm run build
```

## Codex 接入配置

在 Codex 配置文件中添加 MCP server（路径根据实际安装位置调整）：

**macOS / Linux** (`~/.codex/config.toml`):
```toml
[mcp_servers.gemini-frontend]
command = "node"
args = ["/d/gemini-mcp/dist/index.js"]
```

**Windows** (`%USERPROFILE%\.codex\config.toml`):
```toml
[mcp_servers.gemini-frontend]
command = "node"
args = ["D:/gemini-mcp/dist/index.js"]
```

**开发模式（无需预编译）**：
```toml
[mcp_servers.gemini-frontend]
command = "npx"
args = ["tsx", "/d/gemini-mcp/src/index.ts"]
```

## 前置要求

- Node.js >= 18（基础运行要求）
- Node.js >= 22.5（可启用内置 `node:sqlite` 持久化；低于该版本自动回退内存模式）
- Gemini CLI 已安装并认证：`npm install -g @google/gemini-cli`
- 执行 `gemini` 登录认证

## 可用工具

当前共 16 个工具，其中包含 7 个低层前端工具和 9 个面向 Codex 编排的高层工具。`src/tool-manifest.ts` 是工具元数据和注册顺序的单一真源；`npm run sync:readme-tools` 会自动刷新 README 中的工具清单区块，`npm run check:doc-sync` 会校验文档与 manifest 一致性。

其中，直接调用 Gemini CLI 的工具支持可选 `session_id` 复用：`generate_frontend_component`、`create_styles`、`review_ui_design`、`generate_html_structure`、`refactor_component`、`generate_storybook_story`、`convert_framework`、`plan_frontend_solution`、`implement_frontend_task`。

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

### `generate_frontend_component`
生成 React / Vue / HTML 组件。

```json
{
  "component_name": "UserProfileCard",
  "framework": "react",
  "description": "显示用户头像、姓名、角色标签，支持加载状态",
  "props": "user: { name: string, avatar: string, role: string }, loading?: boolean",
  "style_preference": "Tailwind CSS",
  "session_id": "optional-session-id",
  "project_context": {
    "design_system": "shadcn/ui",
    "existing_components": "Avatar, Badge, Card, Skeleton",
    "color_tokens": "--primary: hsl(222.2 47.4% 11.2%)",
    "conventions": "使用 cn() 合并 className; 所有组件为 TypeScript"
  }
}
```

### `create_styles`
生成 CSS / Tailwind / SCSS 样式。

```json
{
  "element_description": "主导航栏，固定顶部，毛玻璃背景效果",
  "style_type": "css",
  "responsive": true,
  "session_id": "optional-session-id",
  "project_context": {
    "color_tokens": "--bg: #fff; --border: #e5e7eb",
    "breakpoints": "sm:640px md:768px lg:1024px"
  }
}
```

### `review_ui_design`
审查 UI 代码，给出可访问性和设计改进建议。

```json
{
  "code": "<button onclick='submit()'>提交</button>",
  "focus_areas": "accessibility, semantic-html",
  "session_id": "optional-session-id",
  "project_context": {
    "design_system": "Ant Design 5.x"
  }
}
```

### `generate_html_structure`
生成语义化 HTML 页面结构。

```json
{
  "page_description": "SaaS 产品落地页，主打 AI 代码生成功能",
  "sections": ["header", "hero", "features", "pricing", "faq", "footer"],
  "semantic_html": true,
  "session_id": "optional-session-id",
  "project_context": {
    "design_system": "自定义营销站点",
    "conventions": "使用 BEM 风格 className"
  }
}
```

### `refactor_component`
重构/优化已有组件代码。

```json
{
  "code": "export function UserCard() { return <div />; }",
  "issues": "prop drilling, loading state is duplicated, markup lacks accessibility labels",
  "target_pattern": "compound component",
  "session_id": "optional-session-id",
  "project_context": {
    "design_system": "shadcn/ui",
    "existing_components": "Card, Avatar, Skeleton",
    "conventions": "React + TypeScript; use cn() for className"
  }
}
```

### `generate_storybook_story`
为组件生成 Storybook Story。

```json
{
  "component_code": "export function Button(props: ButtonProps) { return <button {...props} />; }",
  "component_name": "Button",
  "stories": ["Default", "Loading", "Disabled"],
  "storybook_version": "8",
  "session_id": "optional-session-id",
  "project_context": {
    "design_system": "internal-ui",
    "existing_components": "Button, Spinner",
    "conventions": "Storybook CSF3 + TypeScript"
  }
}
```

### `convert_framework`
框架代码互转（React ↔ Vue）。

```json
{
  "code": "export function Counter() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{count}</button>; }",
  "from": "react",
  "to": "vue",
  "session_id": "optional-session-id"
}
```

### `plan_frontend_solution`
为 Codex 主 agent 生成结构化前端方案片段，不直接生成代码文件。`project_context` 为必填，且 `design_system` / `existing_components` / `conventions` 至少一项为非空字符串。

```json
{
  "goal": "为低代码页面编辑器新增版本对比侧边栏",
  "scope": ["react page", "sidebar", "status badge", "responsive layout"],
  "constraints": ["必须兼容现有设计系统", "不能改动后端接口"],
  "backend_contracts": ["GET /api/version/{id}", "GET /api/version/{id}/diff"],
  "acceptance_criteria": ["支持桌面端和移动端", "状态标签需要区分版本状态"],
  "session_id": "optional-session-id",
  "project_context": {
    "design_system": "internal admin ui",
    "existing_components": "Card, Badge, Drawer, Table",
    "conventions": "React + TypeScript; use cn() for className"
  }
}
```

### `implement_frontend_task`
为 Codex 主 agent 生成结构化前端补丁包，供校验后落盘。`project_context` 和 `allowed_paths` 为必填，且 `design_system` / `existing_components` / `conventions` 至少一项为非空字符串；必须通过 task-augmented 调用使用。

```json
{
  "task_goal": "新增版本对比侧边栏并接入状态标签",
  "related_files": [
    {
      "path": "src/pages/version/VersionList.tsx",
      "content": "export function VersionList() {}"
    }
  ],
  "allowed_paths": ["src/pages/**", "src/components/**"],
  "backend_contracts": ["GET /api/version/{id}", "GET /api/version/{id}/diff"],
  "acceptance_criteria": ["移动端自动折叠", "状态标签区分已发布和草稿"],
  "session_id": "optional-session-id",
  "project_context": {
    "design_system": "internal admin ui",
    "existing_components": "Card, Badge, Drawer, Table",
    "conventions": "React + TypeScript; use cn() for className"
  }
}
```

### `run_orchestrator_graph`
推进主 agent 的 WorkItem DAG 状态，生成下一步 Codex 或 Gemini 动作，并可选持久化到 SQLite。`project_context` 为必填，且 `design_system` / `existing_components` / `conventions` 至少一项为非空字符串；当 `load_if_exists=true` 且存在已绑定 `task_id` 时，会优先复用显式 `task_results`，否则自动从当前 MCP `taskStore` 查询任务状态/结果。

```json
{
  "orchestrator_id": "version-compare-001",
  "persist": true,
  "load_if_exists": true,
  "graph": {
    "schema_version": "1.0",
    "work_items": [
      { "id": "backend-1", "type": "backend", "owner": "codex", "scope": "Implement API", "deps": [], "status": "queued", "input": {}, "acceptance": [] },
      { "id": "frontend-code-1", "type": "frontend-code", "owner": "gemini", "scope": "Build compare drawer", "deps": ["backend-1"], "status": "queued", "input": {}, "acceptance": [] }
    ]
  },
  "project_context": {
    "design_system": "internal admin ui",
    "existing_components": "Card, Drawer, Badge",
    "conventions": "React + TypeScript"
  },
  "work_item_inputs": {
    "frontend-code-1": {
      "task_goal": "Build compare drawer",
      "allowed_paths": ["src/pages/**", "src/components/**"]
    }
  }
}
```


### `run_orchestrator_loop`
执行一次 orchestrator loop tick：推进 DAG、自动提交 ready 的 Gemini work item，并返回更新后的编排状态。`project_context` 为必填，且 `design_system` / `existing_components` / `conventions` 至少一项为非空字符串。若本次调用带 `persist=true` 且配置了 SQLite，服务内的后台 runtime 会继续接管并在重启后自动恢复未终态 runs。

```json
{
  "orchestrator_id": "version-compare-001",
  "persist": true,
  "load_if_exists": true,
  "max_submissions": 1,
  "graph": {
    "schema_version": "1.0",
    "work_items": [
      { "id": "backend-1", "type": "backend", "owner": "codex", "scope": "Implement API", "deps": [], "status": "queued", "input": {}, "acceptance": [] },
      { "id": "frontend-plan-1", "type": "frontend-plan", "owner": "gemini", "scope": "Plan compare drawer", "deps": [], "status": "queued", "input": {}, "acceptance": [] }
    ]
  },
  "project_context": {
    "design_system": "internal admin ui",
    "existing_components": "Card, Drawer, Badge",
    "conventions": "React + TypeScript"
  }
}
```
### `get_orchestrator_state`
读取已持久化的 orchestrator graph/state/summary 快照。`orchestrator_id` 为必填。

```json
{
  "orchestrator_id": "version-compare-001"
}
```

### `get_orchestrator_summary`
读取 orchestrator 的结构化最终汇总、失败补偿状态和 work item 事件轨迹（包含 `failure_diagnostics` 错误聚合）。若后台 runtime 已完成自动重试或进入 manual review，可直接用这个工具读取最终结果。

```json
{
  "orchestrator_id": "version-compare-001"
}
```

### `get_runtime_diagnostics`
读取当前进程的 Gemini runtime、process-control、task execution、orchestrator runtime 和持久化诊断信息，适合排查队列堆积、后台 run 活跃状态、取消回收结果和 SQLite 恢复情况；task execution 结果中包含失败错误类型聚合（failure diagnostics）。

```json
{}
```

### `get_orchestrator_resolution`
读取主 agent 可消费的 orchestrator 决策包，包括 recommended actions、manual actions、已完成结果摘要和自然语言 summary。

```json
{
  "orchestrator_id": "version-compare-001"
}
```

### `apply_orchestrator_resolution`
应用 Codex 对 orchestrator run 的决策，支持 `provide-result`、`retry-work-item` 和 `mark-failed`，必要时会重新激活后台 runtime。

```json
{
  "orchestrator_id": "version-compare-001",
  "resolutions": [
    {
      "kind": "provide-result",
      "work_item_id": "backend-1",
      "result": { "ok": true }
    }
  ]
}
```

## 会话复用（v2.2）

当前实现是“Gemini 原生会话优先，进程内回放兜底”：

- 所有直接调用 Gemini CLI 的工具都接受可选 `session_id`
- 第一次不传 `session_id` 时，服务会创建 Gemini 原生会话，并把该原生 `session_id` 透传回来
- 后续带同一个 `session_id` 调用时，服务优先走 `gemini --resume <session_id>`
- 如果原生恢复失败，但当前 MCP 进程里仍保留该会话的历史上下文，会自动退回到进程内回放模式
- 返回结果会在 `structuredContent` 中携带：
  - `session_id`
  - `session_reused`

### 行为边界

- 若 Gemini CLI 自己还能识别该原生 `session_id`，会话可跨 MCP 进程重启继续使用
- 若原生会话不可恢复，但当前进程里仍有缓存，仍可在本进程内继续
- 若原生恢复失败且当前进程也没有缓存，会返回会话错误
- 空闲过久的本地缓存会话会被自动清理

### 会话调用示例

第一次调用：

```json
{
  "name": "generate_frontend_component",
  "arguments": {
    "component_name": "UserCard",
    "framework": "react",
    "description": "展示头像和姓名的卡片"
  }
}
```

返回值中的 `structuredContent` 示例：

```json
{
  "session_id": "bd4ce5a8-00ff-40e0-bb01-8568a95e1733",
  "session_reused": false
}
```

第二次调用时复用：

```json
{
  "name": "refactor_component",
  "arguments": {
    "code": "...第一次生成的组件代码...",
    "issues": "改成 outlined 风格，并增强 loading 态",
    "session_id": "bd4ce5a8-00ff-40e0-bb01-8568a95e1733"
  }
}
```

## 任务模式与超时建议

当前任务模式分为两类：

- `implement_frontend_task` 以 `taskSupport: required` 注册，必须通过 task-augmented 调用获取 `taskId`
- `implement_frontend_task` 默认进入队列执行，并通过 `statusMessage` 暴露 `queued / prompting / generating / packaging / completed / failed` 阶段
- `run_orchestrator_graph` 以 `taskSupport: optional` 注册，适合做显式单步编排推进；`load_if_exists=true` 时可自动查询已绑定 task 的状态/结果
- `run_orchestrator_loop` 以 `taskSupport: optional` 注册，适合做显式单次 loop tick；当 `persist=true` 时，后台 runtime 会继续自动恢复并推进未终态 orchestrator runs
- `get_orchestrator_state` 以 `taskSupport: optional` 注册，用于读取已持久化的 orchestrator 快照
- `get_orchestrator_summary` 以 `taskSupport: optional` 注册，用于读取结构化最终汇总、失败补偿状态和 work item 事件轨迹
- `get_runtime_diagnostics` 以 `taskSupport: optional` 注册，用于读取当前进程的 runtime metrics / diagnostics 总览与明细
- `get_orchestrator_resolution` 以 `taskSupport: optional` 注册，用于读取主 agent 可消费的 resolution 决策包
- `apply_orchestrator_resolution` 主 agent 结果回填与失败补偿工具 以 `taskSupport: optional` 注册，用于写回 Codex 决策并按需重新激活后台 runtime
- `tasks/cancel` 会把任务置为 `cancelled`；当前实现会对 Gemini 子进程执行“两阶段终止”：先优雅停止、短暂等待，再在必要时强制回收；若仍失败，至少会阻止后续结果落盘
- 除 `implement_frontend_task` 之外，其余 15 个工具仍以 `taskSupport: optional` 注册，可同步调用，也可走 task 模式
- 对长耗时场景，优先建议使用 task 模式，避免单个同步请求长时间挂起

如果调用方仍使用同步 `tools/call`，建议把 MCP 请求超时调高到至少 `240000ms`。当前一些复杂生成/重构请求仍可能超过 SDK 默认的 `60000ms`。

可通过环境变量 `GEMINI_MCP_MAX_FRONTEND_TASKS` 调整 `implement_frontend_task` 的并发槽位，默认值为 `2`。`GEMINI_MCP_MAX_ACTIVE_ORCHESTRATORS` 可限制后台同时活跃的 orchestrator runs 数量，默认 `2`；`GEMINI_MCP_ORCHESTRATOR_TICK_MS` 可调整后台 loop tick 间隔，默认 `1500`；`GEMINI_MCP_ORCHESTRATOR_MAX_GEMINI_RETRIES` 可调整可重试前端节点的自动重试上限，默认 `2`；`GEMINI_MCP_PROCESS_TERMINATION_GRACE_MS` / `GEMINI_MCP_PROCESS_TERMINATION_FORCE_WAIT_MS` 可调整 Gemini 子进程两阶段终止的宽限期与强制回收等待时间。

服务启动日志现在会额外输出 task execution diagnostics 和 orchestrator runtime diagnostics，便于观察 queued / running / cancel_requested / terminal 数量，以及后台 orchestrator 的恢复与活跃情况。

### 首次调用前会做认证预检查吗？

会，但现在是后台探测，不阻塞真实请求：

- 若探测明确识别到未登录，会缓存未认证状态，后续请求可更快返回认证错误
- 若探测超时或结果不确定，会进入一段时间的退避窗口，避免每次请求都额外卡住 `30s`
- 任意一次真实 Gemini 调用成功后，会直接把当前 CLI 标记为已认证

## 项目结构

```
src/
├── index.ts                   # MCP 服务入口
├── gemini-runner.ts           # Gemini CLI 运行时入口（组装路径发现、auth preflight、session/retry 与 process 执行）
├── gemini-runner-errors.ts    # Gemini CLI 错误模型、错误归类与 JSON 输出提取
├── gemini-runner-proxy.ts     # 代理环境解析（env + Windows 注册表）
├── gemini-runner-session.ts   # session TTL、原生 resume 与回放上下文辅助
├── gemini-runner-logging.ts   # runner 结构化日志级别与 sink 配置
├── gemini-runner-auth.ts      # runner 认证探测缓存、预检查与 backoff 控制
├── gemini-runner-process.ts   # runner CLI 子进程参数构造、执行与终止回收
├── task-tool.ts               # task 模块入口（导出注册/提交与执行状态 helper）
├── task-tool-types.ts         # task tool 公共类型与执行选项定义
├── task-tool-lifecycle.ts     # task 执行生命周期与取消 watcher
├── task-tool-registration.ts  # task tool 注册与 managed task 提交
├── task-tool-scheduling.ts    # task 执行模式解析、排队与调度提交复用 helper
├── process-control.ts         # v2.6 Gemini 子进程两阶段终止、强制回收与诊断统计
├── task-execution.ts          # v2.5 执行槽位调度与阶段状态辅助
├── context-builder.ts         # 项目上下文格式化器
├── session-store.ts           # Gemini 会话存储抽象（内存 / 持久化共用）
├── tool-result.ts             # 统一封装 session-aware 工具返回
├── orchestrator-tools.ts      # v2.3 高层编排工具的结构化 JSON / 路径校验辅助
├── orchestrator-contracts.ts  # v2.3 公共输入输出 schema / type contracts
├── orchestrator-validator.ts  # v2.3 补丁消费校验 / 冲突检查辅助
├── orchestrator-state.ts      # v2.6 主 agent 共享 WorkItem / DAG / task-session 状态模型
├── orchestrator-runtime.ts    # v2.6 主 agent runtime 入口（组装 graph/loop 执行）
├── orchestrator-runtime-schemas.ts # v2.6+ runtime 输入/输出 schema 与类型定义
├── orchestrator-runtime-sync.ts # v2.6+ task/session/state 对齐与同步辅助
├── orchestrator-runtime-actions.ts # v2.6+ next-action 与 summary 生成辅助
├── orchestrator-runtime-persistence.ts # v2.6+ runtime 持久化状态与输出构建辅助
├── orchestrator-runtime-manager.ts # v2.6 后台 orchestrator runtime manager 入口（调度/恢复/并发门控）
├── orchestrator-runtime-manager-types.ts # runtime manager 公共类型与 options/diagnostics 定义
├── orchestrator-runtime-manager-helpers.ts # runtime manager 状态与快照 helper
├── orchestrator-runtime-manager-process.ts # runtime manager 单次 run 处理与失败补偿流程
├── orchestrator-runtime-manager-events.ts # runtime manager 事件轨迹追加 helper
├── orchestrator-runtime-manager-retry.ts # runtime manager 失败重试/人工审查策略 helper
├── orchestrator-summary.ts    # v2.6 结构化最终汇总、自然语言摘要与事件轨迹 schema/helper
├── runtime-diagnostics.ts     # v2.6 当前进程 runtime metrics / diagnostics 聚合与 schema
├── orchestrator-resolution.ts # v2.6 主 agent 结果消费与失败补偿 resolution helper
├── sqlite-persistence.ts      # v2.4/v2.6 SQLite 持久化入口（runtime 组装）
├── sqlite-persistence-types.ts # SQLite 持久化公共类型与 store 接口
├── sqlite-persistence-db.ts   # SQLite schema 初始化、恢复逻辑与通用 helper
├── sqlite-task-store-helpers.ts # SQLite task store 查询/过期清理/状态迁移辅助
├── sqlite-orchestrator-store-helpers.ts # SQLite orchestrator row 解析与恢复判定辅助
├── sqlite-task-store.ts       # task store 持久化实现
├── sqlite-task-message-queue.ts # task message queue 持久化实现
├── sqlite-session-store.ts    # Gemini session store 持久化实现
├── sqlite-orchestrator-store.ts # orchestrator snapshot store 持久化实现
└── tools/
    ├── generate-component.ts
    ├── create-styles.ts
    ├── review-ui.ts
    ├── generate-html.ts
    ├── refactor-component.ts
    ├── generate-storybook.ts
    ├── convert-framework.ts
    ├── plan-frontend-solution.ts
    ├── implement-frontend-task.ts
    ├── run-orchestrator-graph.ts
    ├── run-orchestrator-loop.ts
    ├── get-runtime-diagnostics.ts
    └── orchestrator-resolution.ts
```

## 开发

```bash
npm run dev                # 开发模式（tsx，无需编译）
npm run build              # 编译 TypeScript
npm run sync:readme-tools  # 基于 tool-manifest 自动刷新 README 工具区块
npm run check:doc-sync     # 校验 README 生成区块与 manifest/工具章节一致
npm run typecheck          # 类型检查
npm run test               # 构建 + Node 内建测试
```

## 故障排查

### MCP 下工具调用超时，但终端里直接执行 `gemini` 正常

有些 MCP 客户端在通过 `stdio` 启动服务时，只会继承一小部分环境变量。如果你的网络依赖代理，而 `HTTPS_PROXY` / `HTTP_PROXY` 没有透传给本服务，Gemini CLI 可能会一直卡住直到超时。

当前版本会按以下顺序为 Gemini 子进程补代理配置：

1. 当前进程里的 `HTTPS_PROXY` / `HTTP_PROXY`
2. Windows 系统代理注册表（`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`）

如果你使用的是非 Windows 环境，或者 Windows 上使用的是 PAC / 自动代理脚本而不是固定代理地址，仍然建议显式把 `HTTPS_PROXY` 传给 MCP 服务进程。

## 升级路线

> 正式可追踪文档统一放在 `docs/plans/`，`.claude/plan` 仅作为本地工作目录（若存在）。

见 `docs/plans/upgrade-roadmap.md`


## Codex 主Agent协同模式（v2.6 已落地）

当前仓库的目标方向已经调整为：

- Codex 作为唯一主 agent，负责需求理解、任务编排、后端方案/实现、结果汇总
- Gemini 作为前端执行器，负责前端规划与前端编码子任务
- 计划阶段由 Codex 输出后端方案，由 Gemini 输出前端方案，最终由 Codex 汇总形成统一计划
- 编码阶段前端任务应优先走 MCP task 模式，以避免同步阻塞主流程

### 当前状态

以下协同能力目前已经完成，并形成 v2.6 的主线闭环：

- Gemini 前端工具 MCP 化
- 可选 task 模式
- `session_id` 复用
- `project_context` 注入
- `plan_frontend_solution` 高层规划工具
- `implement_frontend_task` 高层补丁工具（含 `allowed_paths` 校验）
- `run_orchestrator_graph` 编排 runtime 工具（生成下一步 Codex / Gemini 动作）
- `run_orchestrator_loop` 单次 loop tick 工具（自动提交 ready 的 Gemini work item）
- `get_orchestrator_state` 持久化快照读取工具
- `get_orchestrator_summary` 结构化最终汇总与事件轨迹读取工具
- `get_runtime_diagnostics` 当前进程 runtime metrics / diagnostics / process-control 查询工具
- `get_orchestrator_resolution` 主 agent 结果消费决策包读取工具
- `apply_orchestrator_resolution` 主 agent 结果回填与失败补偿工具
- 公共 `orchestrator-contracts` 可供主 agent 侧复用
- `orchestrator-validator` 可用于落盘前 schema / 路径 / 冲突检查
- SQLite task/message/session 持久化基础已接入（不可用时自动回退内存）
- SQLite 基础恢复验证已补齐（task result / message queue / session reload）
- 服务重启后会自动回收未完成 task，并标记为失败态
- 已提供主 agent 可复用的 WorkItem / DAG / task-session 映射状态模型
- 已支持 orchestrator SQLite 快照持久化与 `get_orchestrator_state` / `get_orchestrator_summary` 查询
- `run_orchestrator_graph(load_if_exists=true)` 会自动查询已绑定 task 的状态/结果
- 服务启动后会自动恢复未终态 orchestrator runs，并在后台继续推进独立 Gemini 分支
- 后台 orchestrator runtime 已具备全局并发门控、`gemini` 节点自动重试与 manual-review 升级
- 已新增结构化最终汇总、自然语言摘要和每个 work item 的事件轨迹
- 已新增 `get_runtime_diagnostics`，可查询 process-control / task execution / orchestrator runtime / persistence 明细
- 已新增 `get_orchestrator_resolution` / `apply_orchestrator_resolution`，用于主 agent 结果消费与失败补偿闭环

下一阶段重点已经切换到：

- Windows 认证自动化（v3.0）
- Linux / macOS 端到端验证与平台兜底（v3.1）

### 设计文档

详细方案见：

- `docs/plans/2026-03-20-codex-gemini-orchestrator-design.md`
- `docs/plans/2026-03-20-codex-gemini-orchestrator-implementation-plan.md`
- `docs/plans/2026-03-20-codex-gemini-tool-schemas.md`
- `docs/plans/upgrade-roadmap.md`




































