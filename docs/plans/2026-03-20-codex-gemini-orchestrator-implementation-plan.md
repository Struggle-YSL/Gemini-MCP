# Codex 主Agent + Gemini 协同编排实施计划

## Status Update（2026-03-27）

原计划中的 Phase 1 - Phase 4 核心能力已全部落地到当前仓库：

- Phase 1：高层协议与配置已完成
- Phase 2：SQLite 持久化、恢复测试、阶段消息、并发门控已完成
- Phase 3：WorkItem/DAG、runtime/loop、后台恢复、summary/retry/diagnostics/resolution 已完成
- Phase 4：README / roadmap / 协同文档已更新到当前进度

当前后续工作已转入 `v3.0` Windows 认证自动化与 `v3.1` Linux/macOS 平台验证。下文保留原始分阶段计划，作为实现路径记录。
## Summary

本计划用于把 `gemini-mcp` 从“前端工具集合”升级为“可被 Codex 主 agent 调度的前端规划与执行器”。

目标分三步完成：

1. 定义主 agent 配置和高层协议
2. 增强 Gemini MCP 的任务可靠性与结构化返回
3. 建立 Codex 主控的异步任务编排链路

---

## Phase 1: 协议与配置落地

### 目标

建立主 agent 可用的最小闭环：

- 主 agent 知道何时调用 Gemini
- Gemini 能返回结构化前端计划
- Gemini 能返回结构化前端补丁包
- 主 agent 有明确路由规则

### 任务

- 新增 `plan_frontend_solution`
- 新增 `implement_frontend_task`
- 为两个工具定义输入输出 schema
- 将 `project_context` 改为 planning/coding 工具必填
- 定义 orchestrator 配置项
- 定义主 agent 路由规则
- 增加补丁包路径白名单语义

### 交付物

- 工具 schema 文档
- 主 agent 配置草案
- 路由规则草案
- 结构化返回示例

### 验收标准

- 能生成结构化前端计划
- 能生成结构化前端补丁包
- Codex 可根据规则区分前端和后端任务
- 所有前端高层调用都要求 `project_context`

---

## Phase 2: 可靠性与恢复

### 目标

让前端 task 支持重启恢复、状态跟踪和阶段消息。

### 任务

- 用 SQLite 替换 `InMemoryTaskStore`
- 用 SQLite 替换 `InMemoryTaskMessageQueue`
- 持久化 `sessionStore`
- 持久化 task result
- 增加任务阶段状态：
  - `queued`
  - `prompting`
  - `generating`
  - `packaging`
  - `completed`
  - `failed`
- 增加并发上限控制
- 增加任务排队逻辑

### 交付物

- SQLite store 实现
- 任务阶段消息实现
- 并发限制实现
- 重启恢复验证记录

### 验收标准

- 服务重启后可继续通过 `task_id` 查询状态
- 服务重启后可读取历史结果
- 会话可恢复或给出明确错误
- 长任务进度状态可被主 agent 读取

---

## Phase 3: 主Agent编排接入

### 目标

让 Codex 成为真正的主编排者，能够异步调度 Gemini 前端任务。

### 任务

- 定义 `WorkItem` 模型
- 定义 `ExecutionGraph` DAG
- 定义 `task_id -> work_item_id` 映射
- 定义 `session_id -> frontend thread` 映射
- 实现前端任务异步提交
- 实现后端任务继续推进逻辑
- 实现依赖节点轮询前端结果逻辑
- 实现 Gemini 补丁包落盘前校验逻辑
- 实现最终结果汇总格式

### 交付物

- 主 agent 编排状态模型
- 非阻塞执行流程
- 结果汇总格式
- 异常处理逻辑

### 验收标准

- 提交前端任务后 Codex 不阻塞
- Codex 能继续处理后端工作
- 只有依赖边到来时才等待前端结果
- Gemini 返回结果后能被 Codex 正确校验与落盘

---

## Phase 4: 回归与文档收口

### 目标

确保方案可维护、可复用、可继续扩展。

### 任务

- 补充文档
- 更新 roadmap
- 增加示例配置
- 增加异常场景说明
- 增加接口示例
- 增加任务流时序图

### 交付物

- 设计文档
- 实施计划
- 工具 schema 文档
- roadmap 更新稿
- 示例配置片段

### 验收标准

- 新接手的人可按文档理解整体机制
- 文档能直接指导实现
- 路线图中能看出该方案所处阶段

---

## 关键风险

### MCP 客户端能力不足

如果主 agent 当前不支持 task-augmented 调用，则无法真正做到前端异步非阻塞，需要先补 MCP task 支持。

### Gemini 结构化输出波动

若 Gemini 返回 JSON 结构不稳定，需要增加更强的 schema 校验与重试兜底。

### 任务恢复复杂度上升

一旦引入 SQLite 持久化，需要明确 task 生命周期、清理策略和 session 兼容边界。

### 前端补丁冲突

Gemini 返回内容与主 agent 当前已写入文件发生冲突时，需要由 Codex 做统一冲突处理，不能简单覆盖。

---

## 默认实现顺序

```text
1. 先定协议和主agent配置
2. 再做 Gemini 结构化 planning/code 工具
3. 再做 SQLite 持久化
4. 最后接主agent异步编排
```

---

## 最终验收清单

- 能用 Codex 生成后端计划
- 能用 Gemini 生成前端计划
- 能由 Codex 汇总成单份计划
- 前端编码任务能异步提交
- Codex 不被前端长任务阻塞
- 任务重启后可恢复查询
- Gemini 结果必须经过 Codex 校验后落盘
- 最终输出由 Codex 统一生成
