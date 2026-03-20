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

- Node.js >= 18
- Gemini CLI 已安装并认证：`npm install -g @google/gemini-cli`
- 执行 `gemini` 登录认证

## 可用工具

当前共 7 个工具，全部支持可选 `session_id` 参数，并启用了可选 task 模式：

- `generate_frontend_component`
- `create_styles`
- `review_ui_design`
- `generate_html_structure`
- `refactor_component`
- `generate_storybook_story`
- `convert_framework`

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

## 会话复用（v2.2）

当前实现是“Gemini 原生会话优先，进程内回放兜底”：

- 所有工具都接受可选 `session_id`
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

当前 7 个工具都以 `taskSupport: optional` 注册：

- 旧客户端仍可直接使用同步 `tools/call`
- 支持 task 的客户端可改用 task-augmented 调用，先拿 `taskId`，再轮询或流式等待结果
- 对长耗时场景，优先建议使用 task 模式，避免单个同步请求长时间挂起

如果调用方仍使用同步 `tools/call`，建议把 MCP 请求超时调高到至少 `240000ms`。当前一些复杂生成/重构请求仍可能超过 SDK 默认的 `60000ms`。

### 首次调用前会做认证预检查吗？

会，但现在是后台探测，不阻塞真实请求：

- 若探测明确识别到未登录，会缓存未认证状态，后续请求可更快返回认证错误
- 若探测超时或结果不确定，会进入一段时间的退避窗口，避免每次请求都额外卡住 `30s`
- 任意一次真实 Gemini 调用成功后，会直接把当前 CLI 标记为已认证

## 项目结构

```
src/
├── index.ts                   # MCP 服务入口
├── gemini-runner.ts           # Gemini CLI 子进程管理（含路径自愈、后台认证探测、原生 session resume、回放兜底、重试、超时、输出清洗）
├── task-tool.ts               # 可选 task 模式封装（同步兼容 + 任务化执行）
├── context-builder.ts         # 项目上下文格式化器
├── tool-result.ts             # 统一封装 session-aware 工具返回
└── tools/
    ├── generate-component.ts
    ├── create-styles.ts
    ├── review-ui.ts
    ├── generate-html.ts
    ├── refactor-component.ts
    ├── generate-storybook.ts
    └── convert-framework.ts
```

## 开发

```bash
npm run dev        # 开发模式（tsx，无需编译）
npm run build      # 编译 TypeScript
npm run typecheck  # 类型检查
```

## 故障排查

### MCP 下工具调用超时，但终端里直接执行 `gemini` 正常

有些 MCP 客户端在通过 `stdio` 启动服务时，只会继承一小部分环境变量。如果你的网络依赖代理，而 `HTTPS_PROXY` / `HTTP_PROXY` 没有透传给本服务，Gemini CLI 可能会一直卡住直到超时。

当前版本会按以下顺序为 Gemini 子进程补代理配置：

1. 当前进程里的 `HTTPS_PROXY` / `HTTP_PROXY`
2. Windows 系统代理注册表（`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`）

如果你使用的是非 Windows 环境，或者 Windows 上使用的是 PAC / 自动代理脚本而不是固定代理地址，仍然建议显式把 `HTTPS_PROXY` 传给 MCP 服务进程。

## 升级路线

见 `.claude/plan/upgrade-roadmap.md`


