import test from "node:test";
import assert from "node:assert/strict";

import {
  configureGeminiSessionStore,
  configureLogger,
  getGeminiErrorMeta,
  getRuntimeDiagnostics,
  log,
} from "../dist/gemini-runner.js";
import { createInMemoryGeminiSessionStore } from "../dist/session-store.js";

const SESSION_TTL_PADDING_MS = 5 * 60 * 60 * 1000;

test("getRuntimeDiagnostics prunes expired sessions from configured store", () => {
  const store = createInMemoryGeminiSessionStore();
  const now = Date.now();

  store.set({
    id: "active-session",
    nativeSessionId: null,
    createdAt: now,
    updatedAt: now,
    turns: [],
  });

  store.set({
    id: "expired-session",
    nativeSessionId: null,
    createdAt: now - SESSION_TTL_PADDING_MS,
    updatedAt: now - SESSION_TTL_PADDING_MS,
    turns: [],
  });

  configureGeminiSessionStore(store);
  const diagnostics = getRuntimeDiagnostics();

  assert.equal(diagnostics.activeSessions, 1);
  assert.equal(store.size(), 1);
  assert.equal(store.get("expired-session"), undefined);
  assert.ok(
    [
      "env",
      "windows-registry",
      "macos-scutil",
      "linux-gsettings",
      "none",
    ].includes(diagnostics.proxySource),
  );
});

test("getGeminiErrorMeta normalizes generic and primitive errors", () => {
  assert.deepEqual(getGeminiErrorMeta(new Error("boom")), {
    kind: "unknown",
    retryable: null,
    message: "boom",
  });

  assert.deepEqual(getGeminiErrorMeta("plain-error"), {
    kind: "unknown",
    retryable: null,
    message: "plain-error",
  });
});

test("log writes structured payload via configurable sink", () => {
  const captured = [];

  configureLogger({
    level: "warn",
    sink: (entry) => captured.push(entry),
  });

  try {
    log("warn", "runner test message", { source: "unit-test" });
  } finally {
    configureLogger({ level: null, sink: null });
  }

  assert.equal(captured.length, 1);
  const parsed = captured[0];
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.message, "runner test message");
  assert.equal(parsed.source, "unit-test");
  assert.equal(typeof parsed.ts, "number");
});

test("log respects configured minimum log level", () => {
  const captured = [];

  configureLogger({
    level: "error",
    sink: (entry) => captured.push(entry),
  });

  try {
    log("info", "should-be-muted");
    log("warn", "should-also-be-muted");
    log("error", "only-error");
  } finally {
    configureLogger({ level: null, sink: null });
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0].level, "error");
  assert.equal(captured[0].message, "only-error");
});
