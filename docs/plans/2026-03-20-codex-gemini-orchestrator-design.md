# Codex 主Agent + Gemini 前端协同编排设计

## 0. 当前实现状态（2026-03-27）

本设计文档已对应到当前仓库实现。以下能力已经落地：

- `plan_frontend_solution` / `implement_frontend_task` 高层工具
- `run_orchestrator_graph` / `run_orchestrator_loop` / `get_orchestrator_state` / `get_orchestrator_summary` 运行态工具链
- `get_runtime_diagnostics` / `get_orchestrator_resolution` / `apply_orchestrator_resolution` 诊断与结果消费闭环
- SQLite task/message/session/orchestrator 持久化、后台恢复 runtime、自动重试、manual-review 升级
- Gemini 子进程跨平台“两阶段终止 + 强制回收”语义

当前下一阶段重点已经切换到 `v3.0` Windows 认证自动化和 `v3.1` Linux/macOS 端到端验证。本文件保留为架构基线说明。
## 1. 目标

基于当前 `gemini-mcp` 服务，建立一套由 Codex 作为主 agent 统一统筹的协同方案，实现以下能力：

- Codex 作为唯一主 agent，负责任务拆解、依赖编排、后端方案、后端编码、结果汇总和最终输出
- Gemini 作为前端执行器，负责前端规划和前端编码子任务
- 计划阶段由 Codex 输出后端方案，Gemini 输出前端方案，最终由 Codex 汇总形成统一计划
- 编码阶段前端任务自动触发 Gemini 执行，必须异步运行，不同步阻塞 Codex 主流程
- Gemini 不直接写仓库文件，所有结果必须回到 Codex，由 Codex 校验并决定是否落盘

---

## 2. 当前基础

当前仓库已经具备以下能力：

- Gemini CLI 已封装为 MCP 服务
- 前端相关工具已支持可选 task 模式
- 已支持 `session_id` 复用
- 已支持 `project_context` 注入
- 已实现同步调用与异步 task 兼容

当前仍缺少：

- 面向主 agent 的编排协议
- 前端计划阶段专用工具
- 前端编码阶段结构化补丁工具
- 可恢复的任务和会话持久化能力
- 主 agent 的任务图、状态表和汇总机制

---

## 3. 核心原则

### 3.1 单主控

Codex 是唯一主控，Gemini 不参与总决策。  
所有规划、执行、汇总、落盘、验收的最终责任都在 Codex。

### 3.2 前后端职责分离

Codex 负责：

- API
- 数据库
- 服务逻辑
- 算法
- 编排逻辑
- 集成和落盘

Gemini 负责：

- 页面
- 组件
- 样式
- UI 调整
- 前端代码结构化产出

### 3.3 非阻塞执行

前端编码任务必须以异步 task 方式运行。  
Codex 获取 `task_id` 后必须立即继续执行其他任务，只有真正依赖前端结果的节点才允许等待。

### 3.4 结果受控接入

Gemini 只能返回结构化结果，不能直接修改仓库。  
Codex 必须执行路径校验、内容校验、冲突处理和最终写入。

---

## 4. 总体架构

```text
User
  -> Codex Main Agent
       -> 本地生成 BackendPlan / BackendCode
       -> 调用 Gemini MCP 获取 FrontendPlan / FrontendPatch
       -> 维护任务图、依赖关系和状态
       -> 汇总结果、执行校验、写入仓库、输出最终结果
            -> gemini-mcp
                 -> Gemini CLI
```

### 4.1 Codex Main Agent

负责：

- 需求理解
- 任务拆分
- 依赖分析
- 后端方案和实现
- 路由前端子任务给 Gemini
- 汇总所有结果
- 统一输出最终计划和最终交付

### 4.2 Gemini Frontend Executor

负责：

- 生成前端规划片段
- 生成结构化前端补丁包
- 在 task 模式下执行前端长任务
- 通过 `project_context` 对齐项目设计系统和已有组件

---

## 5. 主Agent配置

## 5.1 MCP Server配置

Codex 全局配置示例：

```toml
[mcp_servers.gemini-frontend]
command = "node"
args = ["D:/gemini-mcp/dist/index.js"]
```

开发模式：

```toml
[mcp_servers.gemini-frontend]
command = "npx"
args = ["tsx", "D:/gemini-mcp/src/index.ts"]
```

## 5.2 Orchestrator 配置

建议新增：

```toml
[orchestrator]
role = "orchestrator"
frontend_provider = "gemini-frontend"
frontend_planning_tool = "plan_frontend_solution"
frontend_execution_tool = "implement_frontend_task"
frontend_mode = "async_task_only"
frontend_timeout_ms = 240000
frontend_poll_interval_ms = 2000
frontend_max_parallel_tasks = 2
frontend_allowed_paths = ["src/**", "components/**", "pages/**", "styles/**"]
```

## 5.3 主Agent规则

### 计划阶段

- Codex 必须本地生成后端计划
- 命中前端范围时必须调用 Gemini 生成前端计划
- 最终计划只允许由 Codex 汇总输出

### 编码阶段

- 命中组件、页面、样式、UI 的任务必须路由给 Gemini
- 命中 API、数据库、服务逻辑的任务由 Codex 自行执行
- 前端编码任务必须走 task 模式

### 集成阶段

- Gemini 返回结果后，Codex 才能决定是否写入仓库
- 最终输出必须由 Codex 生成

---

## 6. 计划阶段设计

## 6.1 流程

```text
1. Codex 接收需求
2. Codex 判断是否包含前端范围
3. Codex 生成 BackendPlanFragment
4. Codex 调用 Gemini 的 plan_frontend_solution
5. Gemini 返回 FrontendPlanFragment
6. Codex 合并前后端计划片段
7. Codex 输出 UnifiedPlan
```

## 6.2 目标

计划阶段要求：

- Gemini 只输出前端片段
- Codex 负责统一口径
- 输出中必须包含依赖、风险、测试和假设

---

## 7. 编码阶段设计

## 7.1 流程

```text
1. Codex 将 UnifiedPlan 拆成 WorkItem DAG
2. 后端节点由 Codex 执行
3. 前端节点调用 implement_frontend_task
4. Gemini 返回 task_id
5. Codex 继续执行其他节点
6. 依赖前端结果的节点再轮询 task 状态
7. Gemini 返回 FrontendPatchPackage
8. Codex 校验并落盘
9. Codex 执行检查并输出最终汇总
```

## 7.2 关键约束

- 前端长任务不得同步阻塞
- 前端结果必须结构化
- 所有补丁必须经过 Codex 校验
- 任务失败必须显式记录，不允许静默吞掉

---

## 8. 主Agent内部模型

## 8.1 WorkItem

```ts
type WorkItem = {
  id: string
  type: "backend" | "frontend-plan" | "frontend-code" | "integration"
  owner: "codex" | "gemini"
  scope: string
  deps: string[]
  status: "queued" | "working" | "completed" | "failed"
  input: Record<string, unknown>
  acceptance: string[]
}
```

## 8.2 状态映射

Codex 需要维护：

- `task_id -> work_item_id`
- `session_id -> frontend thread`
- `work_item_id -> status`
- `work_item_id -> result payload`

---

## 9. Gemini MCP扩展要求

需要新增两个高层工具：

- `plan_frontend_solution`
- `implement_frontend_task`

同时需要：

- 强制 `project_context` 必填
- 支持结构化结果
- 支持 task 模式
- 支持持久化任务恢复
- 增加任务阶段进度消息

---

## 10. 持久化与恢复

当前任务和会话主要为内存态，无法满足主 agent 编排需要。  
第一版应改为 SQLite 持久化：

- TaskStore 持久化
- TaskMessageQueue 持久化
- SessionStore 持久化
- task result 持久化

要求支持：

- 重启后按 `task_id` 查询状态
- 重启后获取任务结果
- `session_id` 继续复用或明确失败

---

## 11. 安全边界

Gemini 返回的补丁必须满足：

- 路径必须在白名单内
- 结果结构必须完整
- 所有前端调用都必须传入 `project_context`
- Gemini 不得直接写入仓库

Codex 必须执行：

- 路径白名单校验
- schema 校验
- 冲突处理
- 落盘前检查

---

## 12. 测试与验收

### 计划阶段

- Codex 能生成后端方案
- Gemini 能生成前端方案
- Codex 能合并成一份统一计划

### 编码阶段

- 提交前端任务后 Codex 不阻塞
- Codex 能继续执行后端节点
- 前端结果回来后能正确接入

### 恢复能力

- 重启后可按 `task_id` 查状态
- 重启后可取回 task result
- `session_id` 能继续使用或明确失败

### 安全

- 白名单外路径被拒绝
- 缺少 `project_context` 的调用被拒绝
- 非法结构化结果被拒绝

---

## 13. 结论

该方案的关键是让 Codex 成为唯一编排者，让 Gemini 成为可控的前端规划与实现执行器。  
这样可以同时满足：

- 计划阶段前后端分工明确
- 编码阶段前端自动触发且非阻塞
- 结果始终由 Codex 汇总和把关
- 系统后续可继续演进为更可靠的任务编排架构
