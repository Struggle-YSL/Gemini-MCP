import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  getProcessTerminationDiagnostics,
  resetProcessTerminationDiagnostics,
  terminateProcessTree,
} from "../dist/process-control.js";

class FakeChildProcess extends EventEmitter {
  constructor(pid = 4321) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this.killCalls = [];
    this.onKill = null;
  }

  kill(signal) {
    this.killed = true;
    this.killCalls.push(signal ?? "DEFAULT");
    if (typeof this.onKill === "function") {
      this.onKill(signal ?? "DEFAULT", this);
    }
    return true;
  }

  finish(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

test("terminateProcessTree returns already-exited for finished processes", async () => {
  resetProcessTerminationDiagnostics();
  const proc = new FakeChildProcess();
  proc.exitCode = 0;

  const result = await terminateProcessTree(proc, {
    reason: "abort",
    gracePeriodMs: 5,
    forceWaitMs: 5,
    dependencies: {
      platform: "linux",
    },
  });

  assert.equal(result.outcome, "already-exited");
  assert.equal(result.forceAttempted, false);
  assert.equal(getProcessTerminationDiagnostics().alreadyExited, 1);
});

test("terminateProcessTree records graceful termination when process exits during grace period", async () => {
  resetProcessTerminationDiagnostics();
  const proc = new FakeChildProcess();
  proc.onKill = () => {
    setTimeout(() => proc.finish(0, "SIGTERM"), 5);
  };

  const result = await terminateProcessTree(proc, {
    reason: "abort",
    gracePeriodMs: 25,
    forceWaitMs: 10,
    dependencies: {
      platform: "linux",
    },
  });

  assert.equal(result.outcome, "graceful");
  assert.deepEqual(proc.killCalls, ["SIGTERM"]);
  assert.equal(getProcessTerminationDiagnostics().gracefulTerminations, 1);
});

test("terminateProcessTree escalates to forced termination after grace period", async () => {
  resetProcessTerminationDiagnostics();
  const proc = new FakeChildProcess();
  proc.onKill = (signal) => {
    if (signal === "SIGKILL") {
      setTimeout(() => proc.finish(null, "SIGKILL"), 5);
    }
  };

  const result = await terminateProcessTree(proc, {
    reason: "timeout",
    gracePeriodMs: 10,
    forceWaitMs: 25,
    dependencies: {
      platform: "linux",
      spawnForceKillTree: async () => undefined,
    },
  });

  assert.equal(result.outcome, "forced");
  assert.equal(result.forceAttempted, true);
  assert.deepEqual(proc.killCalls, ["SIGTERM", "SIGKILL"]);
  assert.equal(getProcessTerminationDiagnostics().forcedTerminations, 1);
});

test("terminateProcessTree reports failed-to-terminate when forced cleanup cannot finish", async () => {
  resetProcessTerminationDiagnostics();
  const proc = new FakeChildProcess();

  const result = await terminateProcessTree(proc, {
    reason: "timeout",
    gracePeriodMs: 5,
    forceWaitMs: 5,
    dependencies: {
      platform: "win32",
      spawnForceKillTree: async () => {
        throw new Error("taskkill failed");
      },
    },
  });

  assert.equal(result.outcome, "failed-to-terminate");
  assert.equal(result.forceAttempted, true);
  assert.match(String(result.error), /taskkill failed/i);
  assert.equal(getProcessTerminationDiagnostics().failedTerminations, 1);
});
