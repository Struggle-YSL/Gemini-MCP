import test from "node:test";
import assert from "node:assert/strict";

import { requiredProjectContextSchema } from "../dist/orchestrator-tools.js";
import {
  implementFrontendTaskInputSchema,
  planFrontendSolutionInputSchema,
} from "../dist/orchestrator-contracts.js";
import {
  runOrchestratorGraphInputSchema,
  runOrchestratorLoopInputSchema,
} from "../dist/orchestrator-runtime.js";
import { createWorkItem } from "../dist/orchestrator-state.js";

function hasProjectContextIssue(result) {
  return result.error.issues.some((issue) => {
    return (
      issue.message.includes("project_context") &&
      issue.message.includes("design_system")
    );
  });
}

function createMinimalGraphInput(projectContext) {
  return {
    graph: {
      schema_version: "1.0",
      work_items: [
        createWorkItem({
          id: "backend-1",
          type: "backend",
          owner: "codex",
          scope: "Implement API",
        }),
      ],
    },
    project_context: projectContext,
  };
}

test("requiredProjectContextSchema accepts at least one non-empty core field", () => {
  const parsed = requiredProjectContextSchema.parse({
    design_system: "internal admin ui",
  });

  assert.equal(parsed.design_system, "internal admin ui");
});

test("requiredProjectContextSchema rejects empty object", () => {
  const result = requiredProjectContextSchema.safeParse({});

  assert.equal(result.success, false);
  assert.equal(hasProjectContextIssue(result), true);
});

test("requiredProjectContextSchema rejects whitespace-only core fields", () => {
  const result = requiredProjectContextSchema.safeParse({
    design_system: "   ",
    existing_components: "",
    conventions: "\t",
    color_tokens: "--bg: #fff",
  });

  assert.equal(result.success, false);
  assert.equal(hasProjectContextIssue(result), true);
});

test("planFrontendSolutionInputSchema rejects empty project_context", () => {
  const result = planFrontendSolutionInputSchema.safeParse({
    goal: "Plan a drawer",
    scope: ["drawer"],
    project_context: {},
  });

  assert.equal(result.success, false);
  assert.equal(hasProjectContextIssue(result), true);
});

test("implementFrontendTaskInputSchema rejects empty project_context", () => {
  const result = implementFrontendTaskInputSchema.safeParse({
    task_goal: "Build drawer",
    allowed_paths: ["src/pages/**"],
    project_context: {},
  });

  assert.equal(result.success, false);
  assert.equal(hasProjectContextIssue(result), true);
});

test("runOrchestratorGraphInputSchema rejects empty project_context", () => {
  const result = runOrchestratorGraphInputSchema.safeParse(
    createMinimalGraphInput({}),
  );

  assert.equal(result.success, false);
  assert.equal(hasProjectContextIssue(result), true);
});

test("runOrchestratorLoopInputSchema rejects empty project_context", () => {
  const result = runOrchestratorLoopInputSchema.safeParse(
    createMinimalGraphInput({}),
  );

  assert.equal(result.success, false);
  assert.equal(hasProjectContextIssue(result), true);
});
