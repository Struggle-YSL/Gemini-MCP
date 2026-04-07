# 实施计划：Gemini CLI MCP Server（当前状态快照）

> 版本：v1.0 - v2.6 已落地，下一阶段为 v3.0 / v3.1
> 最后更新：2026-04-04

---

## 当前进度总览

当前仓库已经从最早的“Windows 优先 4 个前端工具”演进为“Codex 主 agent + Gemini 前端执行器”的完整协同底座，已落地能力包括：

- 7 个低层前端工具
- 9 个面向 Codex 编排的高层工具
- Gemini 原生 `session_id` 复用与进程内回放兜底
- SQLite task/message/session/orchestrator 持久化
- `implement_frontend_task` 的 queued/prompting/generating/packaging/completed/failed 阶段消息
- WorkItem / DAG / runtime graph / loop tick / 后台恢复 runtime
- `orchestrator-runtime` 已完成第一轮物理拆分（schemas/sync/actions/persistence）并保持对外 API 兼容
- `gemini-runner` 已完成第一轮物理拆分（errors/proxy/session/logging），对外导出 API 保持兼容
- `sqlite-persistence` 已完成第一轮物理拆分（types/db/task-store/message-queue/session-store/orchestrator-store），对外导出 API 保持兼容
- `orchestrator-runtime-manager` 已完成第一轮物理拆分（types/helpers/process），对外导出 API 保持兼容
- `task-tool` 已完成第一轮物理拆分（types/lifecycle/registration），对外导出 API 保持兼容
- `task-tool` 第二轮内部收敛首步已完成：新增 `task-tool-scheduling.ts` 统一执行模式解析与排队调度提交，`task-tool-registration` 移除 `createTask/getTask/getTaskResult` 回调的 `any` 强转，保持对外协议不变
- `orchestrator-runtime-manager` 第二轮内部收敛第二步已完成：新增 `orchestrator-runtime-manager-events.ts` / `orchestrator-runtime-manager-retry.ts`，将状态变更事件追加与失败重试/人工审查策略从 `process` 主流程中解耦，保持对外协议不变
- `sqlite-persistence` 第二轮内部收敛第三步已完成：新增 `sqlite-task-store-helpers.ts` / `sqlite-orchestrator-store-helpers.ts`，统一 task/orchestrator store 的查询、过期清理、恢复判定与持久化字段合并 helper，保持对外协议不变
- `gemini-runner` 第二轮内部收敛第四步已完成：新增 `gemini-runner-auth.ts` / `gemini-runner-process.ts`，将认证预检查缓存/backoff 控制与 CLI 子进程执行/终止回收从入口解耦，`gemini-runner.ts` 行数 562 -> 296（对外 API 保持兼容）
- O1 第二轮分层单测收尾已完成：新增 4 个测试文件覆盖 auth controller、runner process 参数构造、task scheduling 选项归一化、orchestrator store helper 合并与恢复判定
- O1 第三轮微调首步已完成：`GeminiAuthController` 方法命名统一为 `markAuthenticated` / `markUnauthenticated` / `ensureAuth`，并同步 runner 调用点，保持行为与外部协议不变
- O1 第三轮微调第二步已完成：清理 `gemini-runner-auth` / `gemini-runner-process` / `task-tool-scheduling` 的内部死导出，收敛内部 API 暴露面，保持对外协议与行为不变
- O1 第三轮微调第三步已完成：统一代码/文档术语与注释表述（auth preflight / process / resumeSessionId），并同步 README 与 AGENTS，保持对外协议与行为不变
- O1 收官整理已完成：已归档 O1 全阶段结果并收敛后续入口，优化主线切换为 v3.0 Windows 认证自动化与 v3.1 Linux/macOS 验证
- summary / retry / diagnostics / resolution 闭环
- Gemini 子进程跨平台“两阶段终止 + 强制回收”语义

---

## 工具与编排状态

### 前端执行器能力

已注册低层工具：

- `generate_frontend_component`
- `create_styles`
- `review_ui_design`
- `generate_html_structure`
- `refactor_component`
- `generate_storybook_story`
- `convert_framework`

已注册高层工具：

- `plan_frontend_solution`
- `implement_frontend_task`
- `run_orchestrator_graph`
- `run_orchestrator_loop`
- `get_orchestrator_state`
- `get_orchestrator_summary`
- `get_runtime_diagnostics`
- `get_orchestrator_resolution`
- `apply_orchestrator_resolution`

### 任务与恢复能力

- Node >= 22.5 时优先使用内置 `node:sqlite` 持久化；否则自动回退内存模式
- 服务重启后可恢复 task / result / session / orchestrator snapshot
- 后台 `OrchestratorRuntimeManager` 会自动恢复未终态 runs，并继续推进独立 Gemini 分支
- `gemini` 前端节点支持自动重试，超过上限升级为 `manual-review-required`

### 取消与回收能力

- `tasks/cancel` 会驱动 `AbortController`
- Gemini 子进程统一走“两阶段终止”：先优雅停止，再按平台执行强制回收
- `get_runtime_diagnostics` 可查询最近一次 process-control 回收结果与聚合统计

---

## 当前边界

当前尚未完成的主线工作已经切换到：

- `v3.0` Windows 认证自动化
- `v3.1` Linux / macOS 端到端验证与平台兜底

`v2.3` - `v2.6` 的主 agent 编排协议、持久化、非阻塞执行链路和共享状态模型已经形成闭环。

---

## 关联文档

- `README.md`
- `docs/plans/upgrade-roadmap.md`
- `docs/plans/2026-03-20-codex-gemini-orchestrator-design.md`
- `docs/plans/2026-03-20-codex-gemini-orchestrator-implementation-plan.md`
- `docs/plans/2026-03-20-codex-gemini-tool-schemas.md`
## 文档一致性治理（O14）

- README 工具清单区块改为由 `src/tool-manifest.ts` 自动生成（`npm run sync:readme-tools`）。
- `npm run check:doc-sync` 会校验 README 自动生成区块与 manifest 一致，并校验每个 manifest 工具仍保留详细章节。
- 变更工具清单、工具约束或 task 支持时，先更新 `src/tool-manifest.ts`，再同步并校验文档。





