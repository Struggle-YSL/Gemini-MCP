export interface ProjectContext {
  /** 设计系统，如 "Ant Design 5.x"、"shadcn/ui" */
  design_system?: string;
  /** 已有组件列表，逗号分隔，如 "Button, Modal, Table" */
  existing_components?: string;
  /** CSS 变量，如 "--primary: #1677ff; --danger: #ff4d4f" */
  color_tokens?: string;
  /** 代码约定，如 "使用 clsx 合并 className; TypeScript strict mode" */
  conventions?: string;
  /** 间距基准单位，如 "4px base unit" */
  spacing_scale?: string;
  /** 响应式断点，如 "sm:640px md:768px lg:1024px" */
  breakpoints?: string;
}

/**
 * 将 ProjectContext 对象格式化为 Gemini prompt 中的上下文段落。
 * 仅输出有值的字段，空对象返回空字符串。
 */
export function buildContextSection(ctx: ProjectContext): string {
  const lines: string[] = [];

  if (ctx.design_system) lines.push(`Design System: ${ctx.design_system}`);
  if (ctx.existing_components) lines.push(`Existing Components: ${ctx.existing_components}`);
  if (ctx.color_tokens) lines.push(`Color Tokens: ${ctx.color_tokens}`);
  if (ctx.spacing_scale) lines.push(`Spacing Scale: ${ctx.spacing_scale}`);
  if (ctx.breakpoints) lines.push(`Breakpoints: ${ctx.breakpoints}`);
  if (ctx.conventions) lines.push(`Conventions: ${ctx.conventions}`);

  if (lines.length === 0) return "";

  return ["--- Project Context ---", ...lines, "----------------------"].join("\n");
}
