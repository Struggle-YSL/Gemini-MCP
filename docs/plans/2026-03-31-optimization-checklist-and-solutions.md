# gemini-mcp 项目优化清单与解决方案

- 文档日期：2026-03-31
- 最近更新：2026-04-04
- 适用仓库：`D:\gemini-mcp`
- 结论来源：基于当前仓库代码、测试、README、AGENTS 扫描结果整理
- 当前验证状态：
  - `npm run format:check`：通过
  - `npm run lint`：通过
  - `npm run typecheck`：通过
  - `npm test`：通过（79/79）
  - `npm run sync:readme-tools`：通过
  - `npm run check:doc-sync`：通过

## 1. 目标

本文档用于沉淀当前仓库的可优化项，并给出可执行的解决方案，便于后续按批次推进重构、文档治理和工程化补强。

## 执行进展（2026-04-04）

### 已完成
- O1（拆分超大核心文件）前五阶段已完成：
  - 第一阶段：已将 `src/orchestrator-runtime.ts` 拆分为入口 + 辅助模块：
    - `src/orchestrator-runtime-schemas.ts`
    - `src/orchestrator-runtime-sync.ts`
    - `src/orchestrator-runtime-actions.ts`
    - `src/orchestrator-runtime-persistence.ts`
  - 第二阶段：已将 `src/gemini-runner.ts` 拆分为入口 + 辅助模块：
    - `src/gemini-runner-errors.ts`
    - `src/gemini-runner-proxy.ts`
    - `src/gemini-runner-session.ts`
    - `src/gemini-runner-logging.ts`
  - 第三阶段：已将 `src/sqlite-persistence.ts` 拆分为入口 + 辅助模块：
    - `src/sqlite-persistence-types.ts`
    - `src/sqlite-persistence-db.ts`
    - `src/sqlite-task-store.ts`
    - `src/sqlite-task-message-queue.ts`
    - `src/sqlite-session-store.ts`
    - `src/sqlite-orchestrator-store.ts`
  - 第四阶段：已将 `src/orchestrator-runtime-manager.ts` 拆分为入口 + 辅助模块：
    - `src/orchestrator-runtime-manager-types.ts`
    - `src/orchestrator-runtime-manager-helpers.ts`
    - `src/orchestrator-runtime-manager-process.ts`
  - 第五阶段：已将 `src/task-tool.ts` 拆分为入口 + 辅助模块：
    - `src/task-tool-types.ts`
    - `src/task-tool-lifecycle.ts`
    - `src/task-tool-registration.ts`
  - 行数变化：`gemini-runner.ts` 由 909 行降至 296 行，`sqlite-persistence.ts` 由 562 行降至 37 行，`orchestrator-runtime-manager.ts` 由 571 行降至 173 行，`task-tool.ts` 由 438 行降至 14 行（对外 API 保持兼容）
  - O1 第二轮（内部 API 收敛）首步已完成：新增 `src/task-tool-scheduling.ts`，统一 execution mode/queueKey 解析与排队调度提交逻辑；`task-tool-registration.ts` 去除 `createTask/getTask/getTaskResult` 回调中的 `any` 强转（对外协议保持不变）
  - O1 第二轮（内部 API 收敛）第二步已完成：新增 `src/orchestrator-runtime-manager-events.ts` 与 `src/orchestrator-runtime-manager-retry.ts`，将状态变更事件追加与失败重试/人工审查策略从 `orchestrator-runtime-manager-process.ts` 主流程中解耦（`orchestrator-runtime-manager-process.ts` 行数 334 -> 213，对外协议保持不变）
  - O1 第二轮（内部 API 收敛）第三步已完成：新增 `src/sqlite-task-store-helpers.ts` 与 `src/sqlite-orchestrator-store-helpers.ts`，统一 task/orchestrator store 的查询、过期清理、恢复判定与持久化字段合并逻辑（对外协议保持不变）
  - O1 第二轮（内部 API 收敛）第四步已完成：新增 `src/gemini-runner-auth.ts` 与 `src/gemini-runner-process.ts`，将认证预检查缓存/backoff 与 CLI 子进程执行/终止回收从 `gemini-runner.ts` 入口解耦（`gemini-runner.ts` 行数 562 -> 296，对外协议保持不变）
  - 已通过 `npm run typecheck`、`npm test`、`npm run sync:readme-tools`、`npm run check:doc-sync`
  - O1 收尾测试补齐已完成：新增 `test/gemini-runner-auth.test.mjs`、`test/gemini-runner-process.test.mjs`、`test/sqlite-orchestrator-store-helpers.test.mjs`、`test/task-tool-scheduling.test.mjs`，覆盖新拆分模块的关键边界行为
  - O1 第三轮微调首步已完成：`GeminiAuthController` 内部命名收敛为 `markAuthenticated` / `markUnauthenticated` / `ensureAuth`，并同步 `gemini-runner.ts` 调用点（无对外协议变更）
  - O1 第三轮微调第二步已完成：清理内部死导出与冗余导出面（`gemini-runner-auth.ts` 的 probe runner 类型改为模块内部、`gemini-runner-process.ts` 的 `OutputFormat` 改为内部类型、`task-tool-scheduling.ts` 的内部 options 接口取消导出），对外协议与行为保持不变
  - O1 第三轮微调第三步已完成：统一文档与代码注释术语（`auth preflight`、`process`、`resumeSessionId` 等），同步 `README.md` 与 `AGENTS.md` 描述，保持对外协议与行为不变
  - O1 收官整理已完成：汇总 O1 全阶段（第一轮物理拆分 + 第二轮 API 收敛 + 第三轮微调）最终状态，统一变更清单与后续主线入口（不改对外协议）

- O2（收紧 `project_context` 校验）已完成：
  - `requiredProjectContextSchema` 已收紧为：`design_system` / `existing_components` / `conventions` 至少一项非空
  - 已新增专项测试覆盖空对象、空白字符串、以及高层输入 schema 拦截
  - 已同步 `README.md` 与 `AGENTS.md` 的约束描述
- O3（抽取低层 Gemini 工具公共逻辑）已完成：
  - 新增 `src/tools/frontend-tool-shared.ts`，统一 `session_id` 字段、可选 `project_context` 字段、上下文块拼接、prompt 行拼装
  - 已替换低层工具中的重复逻辑：
    - `generate-component.ts`
    - `create-styles.ts`
    - `generate-html.ts`
    - `review-ui.ts`
    - `refactor-component.ts`
    - `generate-storybook.ts`
    - `convert-framework.ts`
- O4（建立工具注册/文档单一真源）已完成：
  - 新增 `src/tool-manifest.ts` 作为工具元数据与注册顺序真源
  - `src/index.ts` 已改为按 manifest 顺序完成工具注册
  - 新增 `scripts/check-doc-sync.mjs` 与 `npm run check:doc-sync`，校验 README 工具清单与 manifest 一致性
- O14（README/工具 schema 自动一致性校验）已完成：
  - README 工具清单区块已改为由 `src/tool-manifest.ts` 自动生成（`npm run sync:readme-tools`）
  - `npm run check:doc-sync` 已升级为校验：自动生成区块与 manifest 一致、manifest 工具存在 README 详细章节
  - 关键约束（`supportsSessionId` / `requiresProjectContext` / `taskSupport`）已内嵌到自动生成区块，避免手工漂移
- O5（调整正式设计文档存放策略）已完成：
  - 已将 `.claude/plan` 的稳定文档迁移到 `docs/plans/` 并纳入仓库追踪
  - README / AGENTS 已改为以 `docs/plans/` 为正式引用来源，`.claude/plan` 仅保留本地工作目录语义
- O6（统一错误模型）第一阶段已完成：
  - 新增 `src/error-model.ts`，统一任务失败结构为 `{ error: { kind, message, retryable } }`
  - `task-tool` 失败落盘已改为结构化错误结果（`status/progress_stage/error`）
  - `orchestrator-runtime-manager` 已消费结构化错误并写入 retry/manual-review 原因与事件数据
  - 已新增 `test/error-model.test.mjs` 与 runtime-manager 相关回归用例
- O6（统一错误模型）第二阶段已完成：
  - `orchestrator-summary` 新增 `failure_diagnostics` 聚合字段（失败总数、结构化失败数、retryable 统计、failure kinds 分布）
  - `runtime-diagnostics` 的 `task_execution` 新增 `failure_diagnostics`，并在 task records 暴露 `last_error_*` 字段
  - `task-execution` 新增结构化失败记录与聚合函数，供 diagnostics 统一消费
  - 已补充 `runtime-diagnostics` / `task-execution` / `orchestrator-summary` 相关测试覆盖
- O7（集中管理环境变量与默认值）已完成：
  - 新增 src/config.ts，集中管理 GEMINI_MCP_* 配置读取、默认值与最小值约束（含 GEMINI_MCP_MAX_CONCURRENT_TASKS 兼容回退）
  - src/index.ts / src/process-control.ts / src/tools/implement-frontend-task.ts 已改为消费统一配置
  - 服务启动日志新增 runtimeConfig 摘要，便于排查并发与终止策略配置
  - 新增 test/config.test.mjs 覆盖默认值、兼容回退与非法输入 clamp/fallback 场景

- O8（补齐工具层和 runner 层测试）第一阶段已完成：
  - 新增 `test/frontend-tool-shared.test.mjs`，覆盖低层工具公共 helper（prompt 拼接、可选 project_context/schema 字段）
  - 新增 `test/gemini-runner.test.mjs`，覆盖 runner 关键边界（session TTL 剪枝、错误元信息规范化、结构化日志输出）

- O8（补齐工具层和 runner 层测试）第二阶段已完成：
  - 新增 `test/implement-frontend-task.test.mjs`，覆盖工具 handler 关键路径（进度阶段上报、结构化结果包装、allowed_paths 约束）
  - 新增 `test/index-bootstrap.test.mjs`，补充 `src/index.ts` 启动注册 smoke（启动日志包含 `registeredToolCount` 与 `runtimeConfig`）
- O9（将测试代码纳入类型检查）已完成：
  - 新增 `tsconfig.test.json`，将 `test/**/*.mjs` 纳入 TypeScript program（保持 Node test 运行方式不变）
  - `package.json` 新增 `typecheck:src`，并将 `typecheck` 升级为 `npm run build && tsc --noEmit -p tsconfig.test.json`
- O10（降低测试日志噪音）已完成：
  - 新增 `GEMINI_MCP_LOG_LEVEL`（`info|warn|error`）并在 `gemini-runner` 统一按级别过滤日志
  - 测试运行（`node --test` / `npm test`）默认降噪为 `warn` 级别，保留 `error` / `warn` 关键信号
  - logger 新增可配置 sink 与 level override，便于测试按需静默和断言日志行为

- O11（补齐 lint / format / CI）已完成：
  - 新增 `eslint.config.mjs` 与 `npm run lint` / `npm run lint:fix`（覆盖 `src/test/scripts`）
  - 新增 Prettier 基线：`npm run format` / `npm run format:check`，并引入 `.prettierignore`
  - 新增 GitHub Actions 工作流 `.github/workflows/ci.yml`，执行 `format:check`、`lint`、`typecheck`、`test`、`check:doc-sync`
- O12（清理根目录样例与回归文件）已完成：
  - 样例组件已迁移至 `examples/components/`（`RecallProbe.tsx`、`StatusBadge.tsx`、`StatusBadge.module.css`）
  - 回归输出快照已迁移至 `test/fixtures/regression/`（`regression-output.json`、`regression-output-extended.json`）
  - `README.md` 已新增“样例与回归产物”说明，明确这些文件不属于运行时正式源码

### 最新验证

- `npm run format:check`：通过
- `npm run lint`：通过
- `npm run typecheck`：通过
- `npm test`：通过（79/79）
- `npm run sync:readme-tools`：通过
- `npm run check:doc-sync`：通过

### 下一步建议

- O1 收官整理已完成：第二轮与第三轮成果已归档，后续建议转入 v3.0 认证自动化 / v3.1 跨平台验证主线

## 2. 总体结论

当前仓库已经具备较完整的主 agent + Gemini 前端执行器协同能力，主线功能可用，测试基础较好；但在以下方面仍有明显优化空间：

1. 核心模块体积偏大，维护成本上升
2. `project_context` 的协议语义强，但校验仍偏松
3. 多个前端工具存在重复 schema / prompt / 上下文拼接逻辑
4. 文档与代码存在天然漂移风险
5. 配置、错误模型、测试层次仍可继续收敛

## 3. 优化清单总表

| ID | 优化项 | 优先级 | 现状/问题 | 主要文件 |
|---|---|---|---|---|
| O1 | 拆分超大核心文件 | P0 | 单文件过大、职责过多、理解和修改成本高 | `src/orchestrator-runtime.ts`, `src/gemini-runner.ts`, `src/sqlite-persistence.ts`, `src/orchestrator-runtime-manager.ts`, `src/task-tool.ts` |
| O2 | 收紧 `project_context` 校验 | P0 | 高层工具强调必填，但当前可传空对象 `{}` | `src/orchestrator-tools.ts`, `src/orchestrator-contracts.ts`, `src/orchestrator-runtime.ts` |
| O3 | 抽取低层 Gemini 工具公共逻辑 | P0 | 多个工具重复定义 `session_id`、`project_context`、prompt 拼装 | `src/tools/generate-component.ts`, `create-styles.ts`, `generate-html.ts`, `review-ui.ts`, `refactor-component.ts`, `generate-storybook.ts` |
| O4 | 建立工具注册/文档单一真源 | P0 | `index.ts` 与 `README.md` 手工维护，易漂移 | `src/index.ts`, `README.md`, 新增 manifest/helper |
| O5 | 调整正式设计文档存放策略 | P0 | `AGENTS.md`/`README.md` 引用 `.claude/plan`，但 `.claude` 被忽略 | `.gitignore`, `.claude/plan/*`, `README.md`, `AGENTS.md` |
| O6 | 统一错误模型贯穿 task/orchestrator | P1 | `gemini-runner` 有错误类型，但上层多数只保留字符串 | `src/gemini-runner.ts`, `src/task-tool.ts`, `src/orchestrator-resolution.ts`, `src/runtime-diagnostics.ts` |
| O7 | 集中管理环境变量与默认值 | P1 | `process.env` 分散在多个文件，默认值不集中 | `src/index.ts`, `src/process-control.ts`, `src/tools/implement-frontend-task.ts`, `src/gemini-runner.ts` |
| O8 | 补齐工具层和 runner 层测试 | P1 | 当前测试重 orchestrator，轻工具 handler / runner 边界 | `test/*`, `src/tools/*`, `src/gemini-runner.ts`, `src/index.ts` |
| O9 | 将测试代码纳入类型检查 | P1 | `tsconfig.json` 当前只覆盖 `src` | `tsconfig.json`, 新增 `tsconfig.test.json` 或迁移测试 |
| O10 | 降低测试日志噪音 | P1 | 测试输出包含大量 runtime/info 与 SQLite warning | `src/gemini-runner.ts`, `src/index.ts`, `package.json`, test setup |
| O11 | 补齐 lint / format / CI | P1 | 当前仅 build/typecheck/test，缺少持续质量门禁 | `package.json`, 新增 CI 配置 |
| O12 | 清理根目录样例与回归文件 | P2 | 已完成目录治理，样例与回归产物均迁移出根目录 | `examples/components/*`, `test/fixtures/regression/*`, `README.md` |
| O13 | 增加 `engines` 与运行版本说明 | P2 | README 有说明，`package.json` 无强约束 | `package.json`, `README.md` |
| O14 | 增加 README/工具 schema 自动一致性校验 | P2 | 文档改动需人工同步，容易漏改 | 新增 `scripts/` 或 `tools/` 校验脚本 |

## 4. 分项问题与解决方案

### O1. 拆分超大核心文件

#### 现状

以下文件体积已明显偏大：

- `src/orchestrator-runtime.ts`：365 行（已完成第一轮拆分）
- `src/gemini-runner.ts`：296 行（已完成第二轮内部 API 收敛）
- `src/sqlite-persistence.ts`：37 行（已完成第三轮拆分）
- `src/orchestrator-runtime-manager.ts`：173 行（已完成第四轮拆分）
- `src/task-tool.ts`：14 行（已完成第五轮拆分）

#### 风险

- 阅读门槛高，心智负担重
- 改一个点容易波及多条路径
- 后续继续迭代时，文件会继续膨胀
- 测试定位与问题隔离成本高

#### 解决方案

按职责拆分：

1. `src/orchestrator-runtime.ts`
   - `orchestrator-runtime-schemas.ts`
   - `orchestrator-runtime-actions.ts`
   - `orchestrator-runtime-sync.ts`
   - `orchestrator-runtime-persistence.ts`
2. `src/gemini-runner.ts`
   - `gemini-runner-errors.ts`
   - `gemini-runner-proxy.ts`
   - `gemini-runner-session.ts`
   - `gemini-runner-logging.ts`
   - （发现/auth/retry/子进程执行仍由 `gemini-runner.ts` 入口组装）
3. `src/sqlite-persistence.ts`
   - `sqlite-persistence-types.ts`
   - `sqlite-persistence-db.ts`
   - `sqlite-task-store.ts`
   - `sqlite-task-message-queue.ts`
   - `sqlite-session-store.ts`
   - `sqlite-orchestrator-store.ts`
   - （入口与对外类型导出仍由 `sqlite-persistence.ts` 统一）
4. `src/orchestrator-runtime-manager.ts`
   - `orchestrator-runtime-manager-types.ts`
   - `orchestrator-runtime-manager-helpers.ts`
   - `orchestrator-runtime-manager-process.ts`
   - （入口调度与生命周期仍由 `orchestrator-runtime-manager.ts` 统一）
5. `src/task-tool.ts`
   - `task-tool-types.ts`
   - `task-tool-lifecycle.ts`
   - `task-tool-registration.ts`
   - （入口导出仍由 `task-tool.ts` 统一）

#### 推荐实施方式

- 第一轮只做物理拆分，不改变对外 schema
- 拆分后保持原测试全部通过
- 第二轮再做内部 API 收敛

---

### O2. 收紧 `project_context` 校验

#### 现状

- 高层工具文档将 `project_context` 视为强约束
- 但 `requiredProjectContextSchema` 当前字段全部 optional，本质上允许空对象通过

#### 风险

- 调用方以为自己“满足协议”，实际没有提供有效上下文
- 生成质量会在运行期 silently 下降
- 文档语义与代码语义不一致

#### 解决方案

将 `project_context` 分为两层：

1. **存在性约束**：对象必填
2. **有效性约束**：至少以下字段之一非空
   - `design_system`
   - `existing_components`
   - `conventions`

可选增强：
- 对高层工具直接要求上述 3 个字段全部必填
- 对低层工具保留宽松模式，但在服务端记录 warning

#### 建议改动

- `src/orchestrator-tools.ts`
- `src/orchestrator-contracts.ts`
- `src/orchestrator-runtime.ts`
- README / AGENTS 中同步更新说明

---

### O3. 抽取低层 Gemini 工具公共逻辑

#### 现状

多个低层工具都在重复：

- `session_id` 字段定义
- `project_context` schema 片段
- `buildContextSection(...)`
- Gemini prompt 的通用规则段落

#### 风险

- 扩字段时容易漏改
- prompt 约束不统一
- 文档与实现容易漂移

#### 解决方案

新增公共 helper，例如：

- `createSessionIdField()`
- `createOptionalProjectContextSchema(options)`
- `buildGeminiPrompt({ role, context, task, rules })`
- `registerGeminiTextTool(...)`

#### 建议收益

- 降低重复代码
- 降低后续新工具接入成本
- 更容易统一 prompt 风格与返回约束

---

### O4. 建立工具注册/文档单一真源

#### 现状

- `src/index.ts` 手工注册工具
- `README.md` 手工维护工具说明
- 已经出现过实现与 README 轻微漂移

#### 风险

- 每新增/调整工具都要改多个位置
- 很容易出现“代码已改，README 未更新”

#### 解决方案

新增 tool manifest，例如：

```ts
{
  name: "plan_frontend_solution",
  category: "frontend-plan",
  supportsSessionId: true,
  requiresProjectContext: true,
  taskSupport: "optional",
  description: "..."
}
```

再基于 manifest：

- 驱动 `index.ts` 中的注册过程
- 生成 README 中的工具清单
- 供一致性校验脚本使用

#### 推荐落地顺序

1. 先引入 manifest，不改 README 生成方式
2. 再补一个校验脚本
3. 最后决定是否自动生成 README 片段

---

### O5. 调整正式设计文档存放策略

#### 现状

- `README.md` / `AGENTS.md` 把 `.claude/plan/*` 当作关键设计文档来源
- 但 `.gitignore` 忽略了 `.claude`

#### 风险

- 新环境可能拿不到这些设计文档
- 长期来看不适合作为团队共享事实来源

#### 解决方案

二选一：

1. **推荐方案**：把稳定设计文档迁移到 `docs/` 下可追踪目录
2. **保守方案**：保留 `.claude` 作为本地工作目录，但不要在 README / AGENTS 中将其作为正式 source of truth

#### 推荐目录

- `docs/plans/`
- `docs/design/`
- `docs/architecture/`

---

### O6. 统一错误模型贯穿 task / orchestrator

#### 现状

- `src/gemini-runner.ts` 中已有 `GeminiErrorKind`
- 但 task 失败结果大多落成普通错误字符串

#### 风险

- 主 agent 难以基于错误类型做自动处理
- diagnostics / resolution 无法稳定聚合错误类别

#### 解决方案

统一失败结果结构：

```json
{
  "error": {
    "kind": "auth",
    "message": "...",
    "retryable": false
  }
}
```

并让以下链路消费：

- `task-tool.ts`
- `orchestrator-resolution.ts`
- `runtime-diagnostics.ts`
- `orchestrator-summary.ts`

#### 直接收益

- 更好地支持自动重试 / 人工 review / 错误统计

---

### O7. 集中管理环境变量与默认值

#### 现状

环境变量读取分散在：

- `src/index.ts`
- `src/process-control.ts`
- `src/tools/implement-frontend-task.ts`
- `src/gemini-runner.ts`

#### 风险

- 默认值散落
- 配置合法性难统一
- 启动行为不透明

#### 解决方案

新增 `src/config.ts`：

- 统一读取 `process.env`
- 统一 parse / default / clamp
- 提供只读配置对象
- 启动时打印配置摘要

#### 建议纳入的配置

- `GEMINI_MCP_DB_PATH`
- `GEMINI_MCP_MAX_ACTIVE_ORCHESTRATORS`
- `GEMINI_MCP_ORCHESTRATOR_TICK_MS`
- `GEMINI_MCP_ORCHESTRATOR_MAX_GEMINI_RETRIES`
- `GEMINI_MCP_MAX_FRONTEND_TASKS`
- `GEMINI_MCP_PROCESS_TERMINATION_GRACE_MS`
- `GEMINI_MCP_PROCESS_TERMINATION_FORCE_WAIT_MS`
- 未来可新增 `GEMINI_MCP_LOG_LEVEL`

---

### O8. 补齐工具层和 runner 层测试

#### 现状

当前测试主要集中在：

- orchestrator runtime
- runtime manager
- persistence
- scheduler / process-control

相对欠缺：

- `src/tools/*.ts` handler/schema 测试
- `src/index.ts` 注册 smoke test
- `src/gemini-runner.ts` 的 child process/mock 路径测试
- `src/context-builder.ts` / `src/tool-result.ts` 这种小工具模块测试

#### 解决方案

补三类测试：

1. **工具 handler 单测**
   - 校验 prompt 拼接
   - 校验 schema
   - 校验 structured output 包装
2. **server 注册测试**
   - 工具名是否完整
   - task support 是否符合预期
3. **runner mock 测试**
   - missing-cli
   - auth failure
   - session resume failure fallback
   - timeout / cancel / retry

---

### O9. 将测试代码纳入类型检查（已完成）

#### 现状

`tsconfig.json` 仅包含 `src`

#### 风险

- 测试对结构字段的误用不会提前暴露
- 重构时测试可能“语义过时但运行仍勉强通过”

#### 解决方案

已落地：

- 新增 `tsconfig.test.json`
- 将 `test/**/*.mjs` 逐步迁移为 `test/**/*.ts`
- `npm run typecheck` 现已覆盖 src + test program，另保留 `npm run typecheck:src` 兼容纯 src 检查

保守方案：

- 保持 Node test 方式不变
- 但新测试优先使用 TypeScript

---

### O10. 降低测试日志噪音（已完成）

#### 现状

测试输出中包含较多：

- info 级 runtime log
- SQLite experimental warning

#### 风险

- CI 可读性下降
- 真正错误容易被噪音淹没

#### 解决方案

- 引入 `GEMINI_MCP_LOG_LEVEL`（`info|warn|error`）
- `node --test` / `npm test` 运行时默认只输出 `warn/error`（可通过 env 显式覆盖）
- 为 logger 提供可注入 sink
- 测试时允许静默 logger
- 对 SQLite warning 做明确的测试环境说明或过滤策略

---

### O11. 补齐 lint / format / CI（已完成）

#### 现状

优化前 `package.json` 仅有基础构建与测试脚本，缺少 lint / format / CI 质量门禁。

#### 解决方案

已落地：

- 新增 `eslint.config.mjs`，并提供 `npm run lint` / `npm run lint:fix`
- 引入 Prettier，并提供 `npm run format` / `npm run format:check`
- 新增 `.github/workflows/ci.yml`：`npm ci` + `format:check` + `lint` + `typecheck` + `test` + `check:doc-sync`

#### 预期收益

- 提前发现风格与潜在 bug
- 降低多人协作时的格式噪音

---

### O12. 清理根目录样例与回归文件（已完成）

#### 现状

此前根目录混放以下样例与回归文件：

- `RecallProbe.tsx`
- `StatusBadge.tsx`
- `StatusBadge.module.css`
- `regression-output.json`
- `regression-output-extended.json`

#### 已完成改动

- 样例组件迁移至：`examples/components/`
- 回归输出快照迁移至：`test/fixtures/regression/`
- `README.md` 新增“样例与回归产物”小节，说明目录语义和用途

#### 收益

- 根目录职责更清晰，避免与正式源码混淆
- 回归资产集中在 `test/fixtures`，后续可直接复用于自动化回归输入
- 样例组件统一收敛到 `examples`，便于演示和人工检查

---

### O13. 增加 `engines` 与运行版本说明

#### 现状

README 已说明 Node 版本要求，但 `package.json` 中未设置 `engines`

#### 解决方案

在 `package.json` 中加入：

```json
"engines": {
  "node": ">=18"
}
```

并在 README 中明确区分：

- `>=18`：基础运行
- `>=22.5`：可启用 `node:sqlite`

---

### O14. 增加 README/工具 schema 自动一致性校验（已完成）

#### 已落地实现

- 新增 `scripts/sync-readme-tools.mjs`：基于 `src/tool-manifest.ts` 自动生成 README 工具清单区块
- 新增 `scripts/readme-tools-block.mjs`：统一 README 自动生成区块模板（含 `supportsSessionId` / `requiresProjectContext` / `taskSupport`）
- `scripts/check-doc-sync.mjs` 已升级为：
  - 校验 README 自动生成区块与 manifest 一致
  - 校验 manifest 内所有工具都保留 README 详细章节（`### ` + 工具名）

#### 使用方式

- `npm run sync:readme-tools`：刷新 README 自动生成区块
- `npm run check:doc-sync`：校验 README 与 manifest/章节一致

---

## 5. 推荐实施顺序

### 第一批（建议优先完成）

1. O2 收紧 `project_context` 校验
2. O3 抽取低层工具公共逻辑
3. O4 建立工具 manifest / 文档一致性机制
4. O5 调整正式设计文档存放策略

### 第二批（提升维护性）

5. O1 拆分超大核心文件
6. O6 统一错误模型
7. O7 集中管理配置

### 第三批（工程化补强）

8. O8 补齐工具层/runner 测试
9. O9 将测试纳入类型检查
10. O10 降低测试日志噪音
11. O11 补齐 lint / format / CI

### 第四批（清理与治理）

12. O12 清理根目录样例与回归文件
13. O13 增加 `engines`
14. O14 增加 README/实现一致性校验脚本

## 6. 建议的首轮落地范围

若只做一轮“低风险、高收益”的优化，建议范围如下：

- 收紧 `project_context` 校验
- 抽取低层工具公共 schema / prompt helper
- 引入 tool manifest
- 将正式设计文档迁移到 `docs/`
- 增加 `config.ts`

这几项对外行为改动相对可控，但能明显降低后续维护成本。

## 7. 验收建议

每个优化项落地后，建议至少执行：

- `npm run typecheck`
- `npm test`
- README / AGENTS / 方案文档同步检查

针对 O1 / O6 / O7 这类核心重构项，建议额外补：

- 回归测试
- 新旧行为对照验证
- 错误分支测试
- 日志与 diagnostics 输出验证

## 8. 附录：本次扫描中已确认的事实

- 当前测试全部通过：79/79
- 项目已具备较完整的 orchestrator/runtime/persistence/diagnostics 能力
- 当前主要问题不在“功能缺失”，而在“可维护性、可验证性、文档一致性和工程治理”





























