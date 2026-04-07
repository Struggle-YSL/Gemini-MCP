import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

async function waitFor(predicate, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for cli bootstrap log output");
    }
    await delay(25);
  }
}

test("cli --version prints package version", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\d+\.\d+\.\d+/);
});

test("cli returns code 2 for unknown args", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "--unknown-flag"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option/);
});

test("cli bootstrap emits startup log with tool count", async (t) => {
  const child = spawn(
    process.execPath,
    ["dist/cli.js", "--skip-gemini-check"],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GEMINI_MCP_ORCHESTRATOR_TICK_MS: "15",
        GEMINI_MCP_LOG_LEVEL: "info",
      },
    },
  );

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
      await Promise.race([once(child, "close"), delay(3000)]);
    }
  });

  await waitFor(() =>
    /Gemini MCP Server ready|gemini CLI not found/i.test(stderr),
  );

  assert.match(stderr, /registeredToolCount/);
  assert.match(stderr, /runtimeConfig/);

  child.kill();
  await Promise.race([once(child, "close"), delay(3000)]);

  assert.equal(child.exitCode === 0 || child.exitCode === null, true);
  assert.equal(typeof stdout, "string");
});
