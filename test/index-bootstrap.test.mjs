import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

async function waitFor(
  predicate,
  timeoutMs = 10000,
) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for index bootstrap log output");
    }
    await delay(25);
  }
}

test("index bootstrap emits startup log with tool count", async (t) => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GEMINI_MCP_ORCHESTRATOR_TICK_MS: "15",
      GEMINI_MCP_LOG_LEVEL: "info",
    },
  });

  let stderr = "";
  let stdout = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill();
      await Promise.race([
        once(child, "close"),
        delay(3000),
      ]);
    }
  });

  await waitFor(() => /Gemini MCP Server ready|gemini CLI not found/i.test(stderr));

  assert.match(stderr, /registeredToolCount/);
  assert.match(stderr, /runtimeConfig/);

  child.kill();
  await Promise.race([
    once(child, "close"),
    delay(3000),
  ]);

  assert.equal(child.exitCode === 0 || child.exitCode === null, true);
  assert.equal(typeof stdout, "string");
});


