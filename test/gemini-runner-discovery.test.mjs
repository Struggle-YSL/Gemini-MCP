import test from "node:test";
import assert from "node:assert/strict";

import { resolveGeminiWithContext } from "../dist/gemini-runner-discovery.js";

function createContext(options = {}) {
  const existingPaths = new Set(options.existingPaths ?? []);
  const commandOutputs = options.commandOutputs ?? {};

  return {
    platform: options.platform ?? "linux",
    env: options.env ?? {},
    pathExists: (filePath) => existingPaths.has(filePath),
    runCommand: (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      return key in commandOutputs ? commandOutputs[key] : null;
    },
  };
}

test("resolveGeminiWithContext prioritizes GEMINI_PATH when executable exists", () => {
  const resolution = resolveGeminiWithContext(
    createContext({
      platform: "linux",
      env: {
        GEMINI_PATH: "/custom/tools/gemini",
      },
      existingPaths: ["/custom/tools/gemini"],
    }),
  );

  assert.equal(resolution.execPath, "/custom/tools/gemini");
  assert.equal(resolution.globalBinDir, "/custom/tools");
  assert.deepEqual(resolution.searchedPaths, ["/custom/tools"]);
});

test("resolveGeminiWithContext uses system lookup result when available", () => {
  const resolution = resolveGeminiWithContext(
    createContext({
      platform: "linux",
      commandOutputs: {
        "which gemini": "/usr/local/bin/gemini",
      },
      existingPaths: ["/usr/local/bin/gemini"],
    }),
  );

  assert.equal(resolution.execPath, "/usr/local/bin/gemini");
  assert.equal(resolution.globalBinDir, "/usr/local/bin");
  assert.ok(resolution.searchedPaths.includes("/usr/local/bin"));
});

test("resolveGeminiWithContext falls back to npm prefix global bin", () => {
  const resolution = resolveGeminiWithContext(
    createContext({
      platform: "linux",
      commandOutputs: {
        "npm config get prefix": "/opt/node",
      },
      existingPaths: ["/opt/node/bin/gemini"],
    }),
  );

  assert.equal(resolution.execPath, "/opt/node/bin/gemini");
  assert.equal(resolution.globalBinDir, "/opt/node/bin");
  assert.ok(resolution.searchedPaths.includes("/opt/node/bin"));
});

test("resolveGeminiWithContext covers macOS common fallback directories", () => {
  const resolution = resolveGeminiWithContext(
    createContext({
      platform: "darwin",
      env: {
        HOME: "/Users/demo",
      },
      existingPaths: ["/opt/homebrew/bin/gemini"],
    }),
  );

  assert.equal(resolution.execPath, "/opt/homebrew/bin/gemini");
  assert.ok(resolution.searchedPaths.includes("/opt/homebrew/bin"));
});

test("resolveGeminiWithContext returns searched paths when gemini is missing", () => {
  const resolution = resolveGeminiWithContext(
    createContext({
      platform: "linux",
      env: {
        PATH: "/tmp/bin:/usr/local/bin",
      },
      commandOutputs: {
        "npm config get prefix": "/opt/node",
      },
    }),
  );

  assert.equal(resolution.execPath, null);
  assert.equal(typeof resolution.globalBinDir, "string");
  assert.ok(resolution.searchedPaths.includes("/tmp/bin"));
  assert.ok(resolution.searchedPaths.includes("/opt/node/bin"));
});
