import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { validateFrontendPatchResult } from "../dist/orchestrator-validator.js";

function createWorkspaceRoot(name) {
  const baseDir = path.join(process.cwd(), "test-tmp");
  mkdirSync(baseDir, { recursive: true });
  const workspaceRoot = path.join(baseDir, name);
  rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(workspaceRoot, { recursive: true });
  return workspaceRoot;
}

test("validateFrontendPatchResult reports structural patch issues and stale baselines", () => {
  const workspaceRoot = createWorkspaceRoot("validator");
  const existingFile = path.join(workspaceRoot, "src", "pages", "VersionList.tsx");
  mkdirSync(path.dirname(existingFile), { recursive: true });
  writeFileSync(existingFile, "current version content", "utf8");

  const report = validateFrontendPatchResult(
    {
      schema_version: "1.0",
      session_id: "session-1",
      session_reused: false,
      files: [
        {
          path: "src/pages/VersionList.tsx",
          action: "delete",
          content: "should be empty",
          reason: "remove legacy page",
        },
        {
          path: "src/pages/VersionList.tsx",
          action: "update",
          content: "replacement content",
          reason: "duplicate entry",
        },
        {
          path: "src/secret/Admin.tsx",
          action: "create",
          content: "export const Admin = null;",
          reason: "outside allow list",
        },
      ],
      validation_steps: [],
      open_questions: [],
      risks: [],
    },
    {
      allowedPaths: ["src/pages/**"],
      relatedFiles: [
        {
          path: "src/pages/VersionList.tsx",
          content: "stale baseline content",
        },
      ],
      workspaceRoot,
    },
  );

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code).sort(),
    [
      "delete-content-present",
      "duplicate-path",
      "path-outside-allowlist",
      "stale-related-file",
    ].sort(),
  );
});

test("validateFrontendPatchResult warns when create and update targets do not match workspace state", () => {
  const workspaceRoot = createWorkspaceRoot("validator-targets");
  const createTarget = path.join(workspaceRoot, "src", "components", "Existing.tsx");
  mkdirSync(path.dirname(createTarget), { recursive: true });
  writeFileSync(createTarget, "existing file", "utf8");

  const report = validateFrontendPatchResult(
    {
      schema_version: "1.0",
      session_id: "session-2",
      session_reused: true,
      files: [
        {
          path: "src/components/Existing.tsx",
          action: "create",
          content: "new content",
          reason: "should warn because file exists",
        },
        {
          path: "src/components/Missing.tsx",
          action: "update",
          content: "update missing",
          reason: "should warn because file is absent",
        },
      ],
      validation_steps: [],
      open_questions: [],
      risks: [],
    },
    {
      allowedPaths: ["src/components/**"],
      workspaceRoot,
    },
  );

  assert.equal(report.ok, true);
  assert.deepEqual(
    report.issues.map((issue) => issue.code).sort(),
    ["create-target-exists", "update-target-missing"].sort(),
  );
});
