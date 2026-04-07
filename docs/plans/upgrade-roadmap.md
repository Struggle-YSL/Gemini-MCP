# 升级路线图：Gemini CLI MCP Server

> 基准版本：v1.0（Windows 优先，用户需预装 gemini CLI + 完成认证）
> 最后更新：2026-04-07

---

## 版本概览

| 版本 | 主题 | 优先级 | 状态 |
|------|------|--------|------|
| v1.0 | Windows 可用：4 个工具 + 路径解析 + 上下文透传 | - | **已完成** |
| v1.1 | Windows 稳定性增强 | 高 | **已完成** |
| v2.1 | 工具扩展 | 中 | **已完成** |
| v2.2 | 会话复用（多轮对话） | 中 | **已完成（原生 resume + 回放兜底）** |
| v2.3 | Codex 主Agent编排协议 | 高 | **已完成** |
| v2.4 | 可恢复任务与会话持久化 | 高 | **已完成** |
| v2.5 | 非阻塞前端执行链路 | 高 | **已完成** |
| v2.6 | 主Agent共享状态模型 | 高 | **已完成** |
| v3.0 | npm 安装分发（Windows 优先） | 中 | 进行中（本地三场景模拟通过） |
| v3.1 | Linux / macOS 平台支持 | 低 | 进行中（首批兼容改造+CI矩阵接入） |
| v4.0 | 生产级架构（SSE / 缓存 / 多模型路由） | 低 | 待规划 |

---

## v1.1 — Windows 稳定性增强

> 2026-03-19：已完成路径变更重扫、认证预检查和错误分类收口。

### 已落地内容

1. `ensureGeminiPath()`
   每次工具调用前检查当前 `GEMINI.execPath` 是否仍然存在；若丢失则重新解析，避免用户重装 Gemini CLI 后必须手动重启服务。
2. 认证预检查
   首次工具调用前会执行一次短探测；明确识别为未登录时直接返回认证错误，探测超时或结果不确定时只记录告警，不阻断真实请求。
3. 错误分类
   当前已区分 `missing-cli`、`auth`、`timeout`、`network`、`unknown-exit`、`spawn`、`session`，并按可重试性处理。

---

## v2.1 — 工具扩展

> 2026-03-19：已完成 `refactor_component`、`generate_storybook_story`、`convert_framework`。

### 新增工具

#### `refactor_component`
重构/优化已有组件代码。

#### `generate_storybook_story`
为组件生成 Storybook Story。

#### `convert_framework`
框架代码互转（React ↔ Vue）。

---

## v2.2 — 会话复用（多轮对话）

> 2026-03-19：已完成“Gemini 原生 resume + 进程内回放兜底”方案。

### 当前实现

1. 新会话默认走 Gemini headless JSON 输出，直接拿到原生 `session_id`
2. 后续调用优先使用 `gemini --resume <session_id> -p ... --output-format json`
3. 若原生恢复失败，但当前进程里还有历史上下文，则退回到进程内 prompt 回放
4. MCP 返回的 `session_id` 现在优先等于 Gemini CLI 原生会话 ID

### 已验证场景

- 使用 Gemini CLI 直接创建原生会话，再把该 `session_id` 传给 `runGeminiTool`
- 服务成功通过同一个 `session_id` 继续追问，并返回正确结果 `cobalt-58`
- 说明当前实现不是单纯的内存会话，而是已接通 CLI 原生 resume 能力

### 兜底与边界

- 若原生会话可恢复，会话可跨 MCP 进程重启继续使用
- 若原生恢复失败，但当前进程缓存还在，仍可在本进程内继续
- 若两者都不可用，则返回 `session` 类错误
- 当前仍未实现长驻 Gemini 交互式子进程

---

## v2.3 — Codex 主Agent编排协议

> 2026-03-27：高层规划/编码工具、公共 contracts、消费校验与主 agent 运行态工具链已全部落地。
> 目标：让 `gemini-mcp` 从“前端工具集合”升级为“受 Codex 主 agent 调度的前端规划与执行器”。

### 背景

当前服务已经具备：

- 前端工具封装
- task 模式
- `session_id` 复用
- `project_context` 注入

但仍缺少与 Codex 主 agent 配合的高层协议。  
尤其缺少以下能力：

- 计划阶段的前端方案输出协议
- 编码阶段的结构化前端补丁协议
- 主 agent 的统一路由约定

### 升级目标

新增面向主 agent 的高层工具：

- `plan_frontend_solution`
- `implement_frontend_task`

并约定：

- Codex 是唯一主 agent
- Codex 负责后端方案、后端实现、依赖编排和结果汇总
- Gemini 只处理前端规划和前端实现子任务
- 最终计划和最终结果都由 Codex 汇总输出

### 预期结果

完成后将具备以下能力：

- 计划阶段由 Codex 生成后端方案，由 Gemini 生成前端方案
- Codex 能将前后端片段合并为一份统一计划
- 编码阶段前端任务可通过结构化工具被自动调度

---

## v2.4 — 可恢复任务与会话持久化

> 2026-03-27：SQLite task/message/session/orchestrator 持久化、恢复测试与快照读写能力已完整落地。
> 目标：让前端 task 和 session 从“进程内能力”升级为“可恢复能力”。

### 当前问题

当前实现使用：

- `InMemoryTaskStore`
- `InMemoryTaskMessageQueue`
- 进程内 `sessionStore`

这些能力在单进程内可用，但存在明确边界：

- 服务重启后任务状态丢失
- task result 无法可靠恢复
- 长任务不适合作为主 agent 编排基础设施

### 升级目标

引入 SQLite 持久化层，替代当前内存实现：

- 持久化 task 元数据
- 持久化 task result
- 持久化 task message queue
- 持久化 session 状态

### 预期结果

完成后将具备以下能力：

- 服务重启后仍可按 `task_id` 查询状态
- 服务重启后仍可读取历史结果
- `session_id` 可继续复用或明确失败
- 可为主 agent 编排提供稳定的任务状态基础

---

## v2.5 — 非阻塞前端执行链路

> 2026-03-27：非阻塞前端执行链路已完成阶段消息、并发门控、取消恢复与跨平台两阶段回收语义。
> 目标：让前端长任务真正以异步方式融入 Codex 主流程，而不是挂起式调用。

### 背景

虽然当前工具已支持可选 task 模式，但仍缺少“主 agent 视角”的执行约束与任务阶段消息。

要满足“Codex 主控 + Gemini 子任务执行”，需要补齐：

- 前端任务必须异步提交
- Codex 拿到 `task_id` 后继续执行其他节点
- 只有依赖边触发时才等待前端结果
- 长任务要有可观测阶段状态

### 升级目标

补充以下能力：

- 为前端编码任务增加阶段状态：（基础阶段消息已落地）
  - `queued`
  - `prompting`
  - `generating`
  - `packaging`
  - `completed`
  - `failed`
- 增加并发控制和排队机制（基础门控已落地）
- 增加取消与重启恢复语义（最小收敛版已落地）
- 约定主 agent 对前端任务只使用 task 模式
- 结构化返回前端补丁包，交由 Codex 统一校验和落盘

### 预期结果

完成后将具备以下能力：

- 前端任务不会同步阻塞 Codex
- Codex 可在等待前端结果时继续推进后端节点
- 最终前端结果可结构化接入主 agent 编排流程
- 整个执行链路更适合后续扩展为生产级调度模式

---

## v2.6 — 主Agent共享状态模型

> 2026-03-27：`WorkItem` / DAG / runtime tool / loop tick / 后台恢复 runtime / summary+retry+diagnostics+resolution 已形成完整闭环。
> 目标：先把主 agent 运行时依赖的共享协议和状态推进逻辑固定下来，再接真正的编排循环。

### 当前结果

当前仓库已经提供：

- `WorkItem` schema / type
- `ExecutionGraph` DAG 校验与 ready-item 计算
- `task_id -> work_item_id` 绑定辅助
- `session_id -> frontend thread` 绑定辅助
- `work_item_id -> result payload` 状态容器
- `run_orchestrator_graph` 单步 runtime 工具（生成 Codex/Gemini next actions）
- `run_orchestrator_loop` 单次 loop tick 工具（自动提交 ready 的 Gemini work item）
- orchestrator SQLite 快照持久化 / `get_orchestrator_state` 查询
- `run_orchestrator_graph(load_if_exists=true)` 自动查询已绑定 task 的状态/结果
- 后台 `OrchestratorRuntimeManager`：启动自动恢复未终态 runs、继续推进独立 Gemini 分支、并对活跃 runs 做全局并发门控

### 当前结果补充

当前后台 orchestrator runtime 还已经具备：

- `gemini` 前端节点按策略自动重试（默认最多 `2` 次，可通过 `GEMINI_MCP_ORCHESTRATOR_MAX_GEMINI_RETRIES` 调整）
- 超过重试上限或不可自动补偿的节点升级为 `manual-review-required`
- `get_orchestrator_summary` 可读取结构化最终汇总、自然语言摘要和每个 work item 的事件轨迹
- SQLite 快照会同时持久化 runtime 状态、事件流和最终汇总
- `get_runtime_diagnostics` 可读取当前进程的 process-control / task execution / orchestrator runtime / persistence 诊断明细
- `get_orchestrator_resolution` / `apply_orchestrator_resolution` 已把主 agent 结果消费与失败补偿闭环接上
- README 工具清单区块已切换为基于 `tool-manifest` 自动生成，并由 `check:doc-sync` 持续校验一致性
- `orchestrator-runtime` 已完成第一轮无行为变更拆分（schemas/sync/actions/persistence）
- `gemini-runner` 已完成第一轮无行为变更拆分（errors/proxy/session/logging）
- `sqlite-persistence` 已完成第一轮无行为变更拆分（types/db/task-store/message-queue/session-store/orchestrator-store）
- `orchestrator-runtime-manager` 已完成第一轮无行为变更拆分（types/helpers/process）
- `task-tool` 已完成第一轮无行为变更拆分（types/lifecycle/registration）
- `task-tool` 已完成第二轮内部 API 收敛首步：新增 `task-tool-scheduling.ts` 统一 execution mode/queueKey 解析与排队调度提交逻辑，减少 registration 与 managed submit 路径重复
- `orchestrator-runtime-manager` 已完成第二轮内部 API 收敛第二步：新增 `orchestrator-runtime-manager-events.ts` / `orchestrator-runtime-manager-retry.ts`，减少 `process` 主流程职责耦合并统一失败策略入口
- `sqlite-persistence` 已完成第二轮内部 API 收敛第三步：新增 `sqlite-task-store-helpers.ts` / `sqlite-orchestrator-store-helpers.ts`，统一 store 内部查询/恢复判定/字段合并 helper，降低重复 SQL 与状态分支逻辑
- `gemini-runner` 已完成第二轮内部 API 收敛第四步：新增 `gemini-runner-auth.ts` / `gemini-runner-process.ts`，统一认证探测缓存与 CLI 进程执行/终止回收边界，降低入口文件耦合
- O1 第二轮收尾测试已补齐：新增 4 个模块级测试文件，当前 `npm test` 通过（79/79）
- O1 第三轮微调三步已完成：命名一致性、dead export 清理、注释/术语统一均已收敛（不改对外协议）
- O1 第三轮微调第二步已完成：清理内部 dead export（probe runner / OutputFormat / scheduling 内部接口），缩小内部模块暴露面，保持对外协议不变
- O1 第三轮微调第三步已完成：统一注释/术语（auth preflight / process / resumeSessionId）并同步 README 与 AGENTS，保持对外协议不变
- O1 收官整理已完成：后续优化进入低优先级维护，主研发重心切换到 v3.0 npm 安装分发与 v3.1 平台验证
- Gemini 子进程取消/超时已统一为跨平台“两阶段终止 + 强制回收”语义，并带 process-control 诊断统计

### 下一步

下一阶段重点：

- npm 安装分发（Windows 优先）
- Linux / macOS 端到端验证与平台兜底

---
## v3.0 — npm 安装分发（Windows 优先）

> 2026-04-07：已完成首批落地（npm `bin` 入口 + CLI preflight + README npm 接入模板），并完成三种安装路径的本地模拟验收。
> 验收清单：`docs/plans/2026-04-07-v3.0-npm-distribution-checklist.md`

**当前**：已新增 npm `bin` 入口，但现网接入中仍有“源码路径 + `node dist/index.js`”惯性，安装与升级流程尚未完全收敛。

**升级目标**：将服务升级为可通过 npm 直接安装/调用的标准包形态，优先打通 Windows 的一键接入，再为 v3.1 跨平台验证提供统一分发基础。

### 实施方案

1. **包形态标准化**
   - 增加 npm `bin` 入口（示例：`gemini-mcp`）
   - 保持 `dist/index.js` 作为运行入口，CLI 仅负责参数转发与启动前检查
   - 明确 Node 版本约束与启动错误码
2. **三种安装/运行模式**
   - `npx -y gemini-mcp`（零安装，推荐给快速试用）
   - `npm i -g gemini-mcp` 后直接执行 `gemini-mcp`
   - `npm i -D gemini-mcp` 并通过 `node_modules/.bin/gemini-mcp` 集成到项目
3. **启动前预检查（preflight）**
   - 校验 Node 版本、依赖完整性、关键环境变量
   - 校验 `gemini` CLI 是否可执行；缺失时返回明确安装指引
   - 保留现有 auth preflight，但定位为“运行保障”而非 v3.0 主目标
4. **配置与文档迁移**
   - 将示例 MCP 配置从本地源码路径切换为 npm 命令优先
   - README 与 `docs/plans` 同步提供 `npx / 全局 / 项目依赖` 三种模板
5. **发布与回归**
   - 增加 `npm pack` 冒烟验证与安装后启动校验（`npm run check:npm-package` / `npm run release:check`）
   - 回归覆盖：Windows clean machine 首次安装、升级、降级、卸载重装

### 验收标准

- 新机器可在 5 分钟内完成安装并启动 MCP 服务
- 不依赖仓库本地绝对路径即可完成 Codex MCP 配置
- 安装失败/CLI 缺失/认证缺失均返回明确错误与下一步指引
---

## v3.1 — Linux / macOS 平台支持

> 2026-04-07：已完成首批兼容改造（跨平台路径发现 + Unix 代理兜底 + 单测覆盖），并接入 CI 跨平台冒烟矩阵。
> 验收清单：`docs/plans/2026-04-07-v3.1-linux-macos-validation-checklist.md`

**当前**：跨平台运行时基础能力已落地，但 Linux / macOS 真实 clean machine 端到端验收尚未补录。

### 已落地内容

1. **跨平台路径发现增强（`resolveGemini`）**
   - 新增 `gemini-runner-discovery` 模块
   - 覆盖 `GEMINI_PATH`、PATH、`which/where`、npm/pnpm/yarn 全局 bin
   - 增补 Linux/macOS 常见目录兜底（含 `/opt/homebrew/bin`）
2. **Unix 代理探测增强**
   - 在原有 env + Windows 注册表基础上，补充：
     - macOS `scutil --proxy`
     - Linux GNOME `gsettings`
   - 支持 `ALL_PROXY` 兜底
3. **可观测性增强**
   - 运行时诊断新增 `gemini_runtime.searched_paths`
   - `proxy_source` 扩展支持 `macos-scutil` / `linux-gsettings`
4. **回归测试补齐**
   - 新增 `gemini-runner-discovery` 与 `gemini-runner-proxy` 专项单测
5. **验收自动化脚本**
   - 新增 `scripts/check-v31-platform-smoke.mjs`（`npm run check:v31-smoke`）用于三场景安装冒烟（npx/全局/项目依赖）
6. **CI 跨平台矩阵**
   - `.github/workflows/ci.yml` 新增 `v31-platform-smoke`（ubuntu/macos/windows）
   - 统一执行 `npm run check:v31-smoke` 并上传 smoke 报告 artifact（避免报告文件被清理）

7. **工程化质量门禁回补**
   - `package.json` 恢复 `format:check` / `lint` / `lint:fix` 脚本
   - `quality` job 恢复 `format:check` + `lint` 检查
   - `release:check` 收敛为统一发布前质量入口（format/lint/typecheck/test/doc/package/smoke）

### 待完成验收

1. Linux clean machine 三场景（npx / 全局 / 项目依赖）
2. macOS Intel + Apple Silicon 端到端验证
3. 补录 CI smoke artifact 与真实机验收证据（roadmap/README/checklist）并收口状态

---

## v4.0 — 生产级架构

适用于多 Codex 实例共享同一 Gemini MCP 的场景。

| 特性 | 说明 |
|------|------|
| SSE 传输 | HTTP 服务模式，多客户端共享 |
| 流式响应 | 长代码实时输出 |
| 结果缓存 | 审查类工具 LRU 缓存，TTL 30 分钟 |
| 多模型路由 | 简单任务 → gemini-flash，复杂任务 → gemini-pro |

---

## 实施建议顺序

```text
v1.0（已完成）
  └─► v1.1（已完成）
        └─► v2.1（已完成）
              └─► v2.2（已完成，原生 resume + 回放兜底）
                    └─► v2.3 Codex 主Agent编排协议
                          └─► v2.4 可恢复任务与会话持久化
                                └─► v2.5 非阻塞前端执行链路
                                      └─► v2.6 主Agent共享状态模型
                                            └─► v3.0 npm 安装分发
                                                  └─► v3.1 Linux/macOS
                                                        └─► v4.0 生产级（有明确需求时）
```







