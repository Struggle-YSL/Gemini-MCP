import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  frontendPatchOutputSchema,
  type FrontendPatchOutput,
  type ImplementFrontendTaskInput,
} from "./orchestrator-contracts.js";
import {
  assertPathsWithinAllowList,
  parseStructuredResult,
  validateAllowedPaths,
} from "./orchestrator-tools.js";

export type PatchValidationIssueSeverity = "error" | "warning";

export interface PatchValidationIssue {
  severity: PatchValidationIssueSeverity;
  code:
    | "duplicate-path"
    | "delete-content-present"
    | "path-outside-allowlist"
    | "create-target-exists"
    | "update-target-missing"
    | "delete-target-missing"
    | "stale-related-file";
  path?: string;
  message: string;
}

export interface ValidateFrontendPatchOptions {
  allowedPaths: string[];
  relatedFiles?: ImplementFrontendTaskInput["related_files"];
  workspaceRoot?: string;
}

export interface FrontendPatchValidationReport {
  ok: boolean;
  patch: FrontendPatchOutput;
  normalizedAllowedPaths: string[];
  issues: PatchValidationIssue[];
}

function normalizeWorkspaceRelativePath(input: string): string {
  return input.replace(/\\/g, "/").trim();
}

function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string
): { exists: boolean; content: string | null } {
  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return { exists: false, content: null };
  }

  return {
    exists: true,
    content: readFileSync(absolutePath, "utf8"),
  };
}

function buildRelatedFileMap(
  relatedFiles?: ImplementFrontendTaskInput["related_files"]
): Map<string, string> {
  const map = new Map<string, string>();

  for (const file of relatedFiles ?? []) {
    map.set(normalizeWorkspaceRelativePath(file.path), file.content);
  }

  return map;
}

function collectPatchIssues(
  patch: FrontendPatchOutput,
  options: ValidateFrontendPatchOptions,
  normalizedAllowedPaths: string[]
): PatchValidationIssue[] {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const relatedFileMap = buildRelatedFileMap(options.relatedFiles);
  const seenPaths = new Set<string>();
  const issues: PatchValidationIssue[] = [];

  try {
    assertPathsWithinAllowList(
      patch.files.map((file) => file.path),
      normalizedAllowedPaths
    );
  } catch (error) {
    issues.push({
      severity: "error",
      code: "path-outside-allowlist",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  for (const file of patch.files) {
    const normalizedPath = normalizeWorkspaceRelativePath(file.path);

    if (seenPaths.has(normalizedPath)) {
      issues.push({
        severity: "error",
        code: "duplicate-path",
        path: normalizedPath,
        message: `Patch contains duplicate entries for '${normalizedPath}'.`,
      });
      continue;
    }
    seenPaths.add(normalizedPath);

    if (file.action === "delete" && file.content !== "") {
      issues.push({
        severity: "error",
        code: "delete-content-present",
        path: normalizedPath,
        message: `Delete action for '${normalizedPath}' must use empty content.`,
      });
    }

    const currentFile = readWorkspaceFile(workspaceRoot, normalizedPath);
    const relatedBaseline = relatedFileMap.get(normalizeWorkspaceRelativePath(normalizedPath));

    if (
      relatedBaseline !== undefined &&
      currentFile.exists &&
      currentFile.content !== relatedBaseline
    ) {
      issues.push({
        severity: "warning",
        code: "stale-related-file",
        path: normalizedPath,
        message: `Workspace file '${normalizedPath}' no longer matches the related_files baseline used to generate this patch.`,
      });
    }

    if (file.action === "create" && currentFile.exists) {
      issues.push({
        severity: "warning",
        code: "create-target-exists",
        path: normalizedPath,
        message: `Create action targets existing file '${normalizedPath}'. Review whether this should be update instead.`,
      });
    }

    if (file.action === "update" && !currentFile.exists) {
      issues.push({
        severity: "warning",
        code: "update-target-missing",
        path: normalizedPath,
        message: `Update action targets missing file '${normalizedPath}'. Review whether this should be create instead.`,
      });
    }

    if (file.action === "delete" && !currentFile.exists) {
      issues.push({
        severity: "warning",
        code: "delete-target-missing",
        path: normalizedPath,
        message: `Delete action targets missing file '${normalizedPath}'.`,
      });
    }
  }

  return issues;
}

export function validateFrontendPatchResult(
  raw: string | unknown,
  options: ValidateFrontendPatchOptions
): FrontendPatchValidationReport {
  const normalizedAllowedPaths = validateAllowedPaths(options.allowedPaths);
  const patch =
    typeof raw === "string"
      ? parseStructuredResult("frontend_patch_result", raw, frontendPatchOutputSchema)
      : frontendPatchOutputSchema.parse(raw);

  const issues = collectPatchIssues(patch, options, normalizedAllowedPaths);

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    patch,
    normalizedAllowedPaths,
    issues,
  };
}
