import test from "node:test";
import assert from "node:assert/strict";

import { resolveRuntimeConfig } from "../dist/config.js";

test("resolveRuntimeConfig uses documented defaults when env is empty", () => {
  const config = resolveRuntimeConfig({});

  assert.equal(config.dbPath, undefined);
  assert.equal(config.maxActiveOrchestrators, 2);
  assert.equal(config.orchestratorTickMs, 1500);
  assert.equal(config.orchestratorMaxGeminiRetries, 2);
  assert.equal(config.maxFrontendTasks, 2);
  assert.equal(config.processTerminationGraceMs, 1500);
  assert.equal(config.processTerminationForceWaitMs, 1000);
  assert.equal(config.logLevel, "info");
});

test("resolveRuntimeConfig supports legacy frontend concurrency env fallback", () => {
  const fromLegacy = resolveRuntimeConfig({
    GEMINI_MCP_MAX_CONCURRENT_TASKS: "5",
  });
  assert.equal(fromLegacy.maxFrontendTasks, 5);

  const fromPrimary = resolveRuntimeConfig({
    GEMINI_MCP_MAX_FRONTEND_TASKS: "3",
    GEMINI_MCP_MAX_CONCURRENT_TASKS: "7",
  });
  assert.equal(fromPrimary.maxFrontendTasks, 3);
});

test("resolveRuntimeConfig clamps or defaults invalid numeric env values", () => {
  const config = resolveRuntimeConfig({
    GEMINI_MCP_DB_PATH: "   D:/tmp/gemini.sqlite   ",
    GEMINI_MCP_MAX_ACTIVE_ORCHESTRATORS: "0",
    GEMINI_MCP_ORCHESTRATOR_TICK_MS: "not-a-number",
    GEMINI_MCP_ORCHESTRATOR_MAX_GEMINI_RETRIES: "-3",
    GEMINI_MCP_MAX_FRONTEND_TASKS: "-1",
    GEMINI_MCP_PROCESS_TERMINATION_GRACE_MS: "0",
    GEMINI_MCP_PROCESS_TERMINATION_FORCE_WAIT_MS: "-9",
    GEMINI_MCP_LOG_LEVEL: "verbose",
  });

  assert.equal(config.dbPath, "D:/tmp/gemini.sqlite");
  assert.equal(config.maxActiveOrchestrators, 1);
  assert.equal(config.orchestratorTickMs, 1500);
  assert.equal(config.orchestratorMaxGeminiRetries, 0);
  assert.equal(config.maxFrontendTasks, 1);
  assert.equal(config.processTerminationGraceMs, 1);
  assert.equal(config.processTerminationForceWaitMs, 1);
  assert.equal(config.logLevel, "info");
});

test("resolveRuntimeConfig accepts supported GEMINI_MCP_LOG_LEVEL values", () => {
  assert.equal(
    resolveRuntimeConfig({ GEMINI_MCP_LOG_LEVEL: "warn" }).logLevel,
    "warn",
  );
  assert.equal(
    resolveRuntimeConfig({ GEMINI_MCP_LOG_LEVEL: "ERROR" }).logLevel,
    "error",
  );
});
