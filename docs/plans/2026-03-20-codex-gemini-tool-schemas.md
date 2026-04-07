# Codex + Gemini 编排工具 Schema 草案

## 0. 当前状态（2026-03-27）

本文档中的 `plan_frontend_solution` / `implement_frontend_task` schema 已在当前代码中落地；此外，仓库已经进一步实现并注册：

- `run_orchestrator_graph`
- `run_orchestrator_loop`
- `get_orchestrator_state`
- `get_orchestrator_summary`
- `get_runtime_diagnostics`
- `get_orchestrator_resolution`
- `apply_orchestrator_resolution`

因此本文档现在主要作为高层工具协议基线；最新实现进度以 `README.md` 和 `upgrade-roadmap.md` 为准。
## 1. 设计目标

本文件定义主 agent 与 `gemini-mcp` 之间新增的高层协议，用于支撑：

- 计划阶段前端方案生成
- 编码阶段前端补丁生成
- task 模式异步执行
- 结构化结果汇总
- 路径白名单和上下文约束

---

## 2. 通用约束

### 2.1 必填上下文

所有前端 planning / coding 工具都必须传入 `project_context`。

### 2.2 结构化输出

所有新增高层工具都必须返回：

- `schema_version`
- `session_id`
- `session_reused`

### 2.3 路径白名单

所有补丁类工具都必须接受 `allowed_paths`，并在服务端校验。

### 2.4 Task 约束

前端编码类工具默认支持 task 模式。  
Codex 编排路径中必须优先使用 task 模式，不允许长耗时同步等待。

---

## 3. Tool: plan_frontend_solution

## 3.1 用途

用于计划阶段生成前端方案片段，不直接生成代码文件。

## 3.2 输入

```ts
type PlanFrontendSolutionInput = {
  goal: string
  scope: string[]
  constraints?: string[]
  backend_contracts?: string[]
  acceptance_criteria?: string[]
  project_context: {
    design_system?: string
    existing_components?: string
    color_tokens?: string
    conventions?: string
    spacing_scale?: string
    breakpoints?: string
  }
  session_id?: string
}
```

## 3.3 字段说明

- `goal`
  - 当前前端目标描述
- `scope`
  - 前端变更范围，如页面、组件、样式、交互
- `constraints`
  - 前端限制条件
- `backend_contracts`
  - 后端接口约束或数据结构说明
- `acceptance_criteria`
  - 验收标准
- `project_context`
  - 项目设计系统、组件库、风格和约定
- `session_id`
  - 可选，用于多轮前端规划上下文复用

## 3.4 输出

```ts
type FrontendPlanFragment = {
  schema_version: "1.0"
  session_id: string
  session_reused: boolean
  summary: string
  ui_changes: string[]
  components: string[]
  api_dependencies: string[]
  risks: string[]
  tests: string[]
  assumptions: string[]
}
```

## 3.5 输出说明

- `summary`
  - 前端方案概述
- `ui_changes`
  - 页面或交互变化列表
- `components`
  - 涉及的组件清单
- `api_dependencies`
  - 前端依赖的后端接口或字段
- `risks`
  - 方案风险
- `tests`
  - 推荐验证项
- `assumptions`
  - 当前前端方案的默认前提

---

## 4. Tool: implement_frontend_task

## 4.1 用途

用于编码阶段异步执行前端任务，输出结构化补丁包。

## 4.2 输入

```ts
type ImplementFrontendTaskInput = {
  task_goal: string
  related_files?: Array<{
    path: string
    content: string
  }>
  allowed_paths: string[]
  backend_contracts?: string[]
  acceptance_criteria?: string[]
  project_context: {
    design_system?: string
    existing_components?: string
    color_tokens?: string
    conventions?: string
    spacing_scale?: string
    breakpoints?: string
  }
  session_id?: string
}
```

## 4.3 字段说明

- `task_goal`
  - 当前前端子任务目标
- `related_files`
  - 与该任务相关的已有文件上下文
- `allowed_paths`
  - Gemini 可返回的文件路径白名单
- `backend_contracts`
  - 前后端接口契约
- `acceptance_criteria`
  - 子任务验收标准
- `project_context`
  - 项目设计系统和开发约定
- `session_id`
  - 可选，用于连续前端编码上下文复用

## 4.4 输出

```ts
type FrontendPatchPackage = {
  schema_version: "1.0"
  session_id: string
  session_reused: boolean
  task_id?: string
  status?: "queued" | "working" | "completed" | "failed"
  progress_stage?: "queued" | "prompting" | "generating" | "packaging" | "completed" | "failed"
  files: Array<{
    path: string
    action: "create" | "update" | "delete"
    content: string
    reason: string
  }>
  validation_steps: string[]
  open_questions: string[]
  risks: string[]
}
```

## 4.5 输出说明

- `task_id`
  - task 模式下的任务标识
- `status`
  - 当前任务状态
- `progress_stage`
  - 当前阶段
- `files`
  - 文件级补丁信息
- `validation_steps`
  - 建议主 agent 或工程执行的验证动作
- `open_questions`
  - 尚未完全确定的问题
- `risks`
  - 当前变更风险

---

## 5. 错误类型建议

建议统一错误分类：

```ts
type OrchestratorToolErrorKind =
  | "missing-cli"
  | "auth"
  | "timeout"
  | "network"
  | "unknown-exit"
  | "spawn"
  | "session"
  | "invalid-schema"
  | "invalid-path"
  | "missing-project-context"
```

### 典型场景

- `missing-cli`
  - Gemini CLI 不存在
- `auth`
  - Gemini 未认证
- `timeout`
  - 前端任务超时
- `session`
  - `session_id` 恢复失败
- `invalid-schema`
  - Gemini 返回结构不完整
- `invalid-path`
  - 返回文件超出允许路径
- `missing-project-context`
  - 调用时未提供项目上下文

---

## 6. Task 模式建议

## 6.1 计划工具

`plan_frontend_solution` 可以支持同步或 task 两种模式。  
默认仍可同步，因为计划片段通常较短。

## 6.2 编码工具

`implement_frontend_task` 必须优先 task 模式。  
主 agent 编排路径中，禁止对该工具做长时间同步等待。

---

## 7. 主Agent消费规则

Codex 消费 `FrontendPlanFragment` 时：

- 只作为前端子计划输入
- 不直接作为最终计划输出
- 必须与后端计划合并后统一对外

Codex 消费 `FrontendPatchPackage` 时：

- 必须先校验 schema
- 必须校验路径白名单
- 必须处理冲突
- 通过后才允许落盘

---

## 8. 示例

## 8.1 plan_frontend_solution 输入示例

```json
{
  "goal": "为低代码页面编辑器新增版本对比侧边栏",
  "scope": ["react page", "sidebar", "status badge", "responsive layout"],
  "constraints": ["必须兼容现有设计系统", "不能改动后端接口"],
  "backend_contracts": ["GET /api/version/{id}", "GET /api/version/{id}/diff"],
  "acceptance_criteria": ["支持桌面端和移动端", "状态标签需要区分版本状态"],
  "project_context": {
    "design_system": "internal admin ui",
    "existing_components": "Card, Badge, Drawer, Table",
    "conventions": "React + TypeScript; use cn() for className"
  }
}
```

## 8.2 implement_frontend_task 输出示例

```json
{
  "schema_version": "1.0",
  "session_id": "abc-123",
  "session_reused": true,
  "status": "completed",
  "progress_stage": "completed",
  "files": [
    {
      "path": "src/pages/version/VersionDiffPanel.tsx",
      "action": "create",
      "content": "export function VersionDiffPanel() {}",
      "reason": "新增版本对比面板组件"
    }
  ],
  "validation_steps": [
    "运行前端类型检查",
    "验证移动端布局折叠行为",
    "验证版本状态标签颜色和文案"
  ],
  "open_questions": [],
  "risks": [
    "若后端 diff 字段缺失，前端展示可能需要降级处理"
  ]
}
```

---

## 9. 结论

这两个高层工具是主 agent 编排的核心边界。  
低层前端工具仍可保留，但主流程应尽量只依赖：

- `plan_frontend_solution`
- `implement_frontend_task`

这样可以保证：

- 协议稳定
- 主 agent 容易编排
- 结果更易校验
- 后续扩展更容易
