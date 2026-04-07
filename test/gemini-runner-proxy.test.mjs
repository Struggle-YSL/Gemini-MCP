import test from "node:test";
import assert from "node:assert/strict";

import { resolveProxyEnvWithContext } from "../dist/gemini-runner-proxy.js";

function createContext(options = {}) {
  const commandOutputs = options.commandOutputs ?? {};

  return {
    platform: options.platform ?? "linux",
    env: options.env ?? {},
    runCommand: (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      return key in commandOutputs ? commandOutputs[key] : null;
    },
  };
}

test("resolveProxyEnvWithContext prefers explicit HTTP/HTTPS proxy env", () => {
  const resolved = resolveProxyEnvWithContext(
    createContext({
      env: {
        HTTP_PROXY: "http://127.0.0.1:7890",
        HTTPS_PROXY: "http://127.0.0.1:7891",
        NO_PROXY: "localhost,127.0.0.1",
      },
    }),
  );

  assert.equal(resolved.source, "env");
  assert.equal(resolved.env.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(resolved.env.HTTPS_PROXY, "http://127.0.0.1:7891");
  assert.equal(resolved.env.NO_PROXY, "localhost,127.0.0.1");
});

test("resolveProxyEnvWithContext falls back to ALL_PROXY when HTTP/HTTPS are missing", () => {
  const resolved = resolveProxyEnvWithContext(
    createContext({
      env: {
        ALL_PROXY: "127.0.0.1:8888",
      },
    }),
  );

  assert.equal(resolved.source, "env");
  assert.equal(resolved.env.HTTP_PROXY, "http://127.0.0.1:8888");
  assert.equal(resolved.env.HTTPS_PROXY, "http://127.0.0.1:8888");
  assert.equal(resolved.env.ALL_PROXY, "http://127.0.0.1:8888");
});

test("resolveProxyEnvWithContext parses macOS scutil proxy output", () => {
  const resolved = resolveProxyEnvWithContext(
    createContext({
      platform: "darwin",
      commandOutputs: {
        "scutil --proxy": [
          "<dictionary> {",
          "  HTTPEnable : 1",
          "  HTTPProxy : 127.0.0.1",
          "  HTTPPort : 7890",
          "  HTTPSEnable : 1",
          "  HTTPSProxy : 127.0.0.1",
          "  HTTPSPort : 7891",
          "}",
        ].join("\n"),
      },
    }),
  );

  assert.equal(resolved.source, "macos-scutil");
  assert.equal(resolved.env.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(resolved.env.HTTPS_PROXY, "http://127.0.0.1:7891");
});

test("resolveProxyEnvWithContext parses linux gsettings manual mode", () => {
  const resolved = resolveProxyEnvWithContext(
    createContext({
      platform: "linux",
      commandOutputs: {
        "gsettings get org.gnome.system.proxy mode": "'manual'",
        "gsettings get org.gnome.system.proxy.http host": "'127.0.0.1'",
        "gsettings get org.gnome.system.proxy.http port": "7890",
        "gsettings get org.gnome.system.proxy.https host": "'127.0.0.1'",
        "gsettings get org.gnome.system.proxy.https port": "7891",
      },
    }),
  );

  assert.equal(resolved.source, "linux-gsettings");
  assert.equal(resolved.env.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(resolved.env.HTTPS_PROXY, "http://127.0.0.1:7891");
});

test("resolveProxyEnvWithContext returns none when no proxy strategy is available", () => {
  const resolved = resolveProxyEnvWithContext(
    createContext({
      platform: "linux",
      commandOutputs: {
        "gsettings get org.gnome.system.proxy mode": "'none'",
      },
    }),
  );

  assert.equal(resolved.source, "none");
  assert.deepEqual(resolved.env, {});
});
