import test from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_MANIFEST,
  assertToolManifestIntegrity,
} from "../dist/tool-manifest.js";

test("tool manifest has unique tool names and expected tool count", () => {
  assert.doesNotThrow(() => assertToolManifestIntegrity());
  assert.equal(TOOL_MANIFEST.length, 16);

  const names = TOOL_MANIFEST.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
});

test("tool manifest marks session/project-context/task-support constraints consistently", () => {
  const byName = new Map(TOOL_MANIFEST.map((tool) => [tool.name, tool]));

  assert.equal(byName.get("implement_frontend_task")?.taskSupport, "required");
  assert.equal(byName.get("run_orchestrator_graph")?.requiresProjectContext, true);
  assert.equal(byName.get("run_orchestrator_loop")?.requiresProjectContext, true);

  const sessionAwareTools = TOOL_MANIFEST.filter((tool) => tool.supportsSessionId).map((tool) => tool.name);
  assert.equal(sessionAwareTools.includes("generate_frontend_component"), true);
  assert.equal(sessionAwareTools.includes("plan_frontend_solution"), true);
  assert.equal(sessionAwareTools.includes("get_runtime_diagnostics"), false);
});
