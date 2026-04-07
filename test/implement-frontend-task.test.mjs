import test from "node:test";
import assert from "node:assert/strict";

import {
  executeImplementFrontendTask,
  getImplementFrontendTaskExecutionOptions,
} from "../dist/tools/implement-frontend-task.js";

const baseArgs = {
  task_goal: "Add version compare drawer",
  allowed_paths: ["src/components/**"],
  project_context: {
    design_system: "internal-ui",
  },
};

test("getImplementFrontendTaskExecutionOptions uses queued mode and positive concurrency", () => {
  const options = getImplementFrontendTaskExecutionOptions();
  assert.equal(options.mode, "queued");
  assert.equal(options.queueKey, "frontend-implementation");
  assert.equal(options.concurrencyLimit >= 1, true);
});

test("executeImplementFrontendTask builds structured completed result with progress stages", async () => {
  const stages = [];
  const calls = [];

  const result = await executeImplementFrontendTask(
    {
      ...baseArgs,
      related_files: [
        {
          path: "src/components/VersionDrawer.tsx",
          content: "export function VersionDrawer() {}",
        },
      ],
      backend_contracts: ["GET /api/version/{id}"],
      acceptance_criteria: ["support mobile collapse"],
      session_id: "session-001",
    },
    {
      taskId: "task-001",
      reportProgressStage: async (stage, detail) => {
        stages.push({ stage, detail });
      },
      throwIfAborted: () => undefined,
    },
    {
      runGeminiToolFn: async (toolName, prompt, options) => {
        calls.push({ toolName, prompt, options });
        return {
          text: JSON.stringify({
            files: [
              {
                path: "src/components/VersionDrawer.tsx",
                action: "update",
                content: "export function VersionDrawer(){ return null; }",
                reason: "wire compare panel",
              },
            ],
            validation_steps: ["npm run test"],
            open_questions: [],
            risks: [],
          }),
          sessionId: "native-session-id",
          sessionReused: true,
        };
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "implement_frontend_task");
  assert.match(calls[0].prompt, /Allowed paths: src\/components\/\*\*/);
  assert.equal(calls[0].options.sessionId, "session-001");

  assert.deepEqual(stages.map((item) => item.stage), ["prompting", "generating", "packaging"]);
  assert.equal(result.structuredContent.status, "completed");
  assert.equal(result.structuredContent.progress_stage, "completed");
  assert.equal(result.structuredContent.task_id, "task-001");
  assert.equal(result.structuredContent.session_id, "native-session-id");
  assert.equal(result.structuredContent.session_reused, true);
  assert.equal(result.structuredContent.files.length, 1);
});

test("executeImplementFrontendTask rejects files outside allowed paths", async () => {
  await assert.rejects(
    executeImplementFrontendTask(
      baseArgs,
      undefined,
      {
        runGeminiToolFn: async () => ({
          text: JSON.stringify({
            files: [
              {
                path: "scripts/outside.ts",
                action: "create",
                content: "export {};",
                reason: "bad path",
              },
            ],
            validation_steps: [],
            open_questions: [],
            risks: [],
          }),
          sessionId: "session-any",
          sessionReused: false,
        }),
      }
    ),
    /outside allowed_paths/i,
  );
});
