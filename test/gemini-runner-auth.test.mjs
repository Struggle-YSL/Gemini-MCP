import test from "node:test";
import assert from "node:assert/strict";

import { GeminiAuthController } from "../dist/gemini-runner-auth.js";

test("GeminiAuthController throws auth error when cached status is unauthenticated", () => {
  const controller = new GeminiAuthController({ authProbeBackoffMs: 60_000 });
  controller.markUnauthenticated("exec-A");

  assert.throws(() => {
    controller.ensureAuth("exec-A", async () => "ok");
  }, /authentication is required/i);
});

test("GeminiAuthController skips probe when cached status is authenticated", () => {
  const controller = new GeminiAuthController();
  controller.markAuthenticated("exec-B");

  let calls = 0;
  controller.ensureAuth("exec-B", async () => {
    calls += 1;
    return "ok";
  });

  assert.equal(calls, 0);
});

test("GeminiAuthController deduplicates in-flight probes for same execPath", async () => {
  const controller = new GeminiAuthController();

  let calls = 0;
  let releaseProbe = () => {};
  const probeGate = new Promise((resolve) => {
    releaseProbe = resolve;
  });

  controller.ensureAuth("exec-C", async () => {
    calls += 1;
    await probeGate;
    return "ok";
  });

  controller.ensureAuth("exec-C", async () => {
    calls += 1;
    return "ok";
  });

  assert.equal(calls, 1);

  releaseProbe();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
