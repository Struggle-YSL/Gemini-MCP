import test from "node:test";
import assert from "node:assert/strict";

import { buildSpawnArgs } from "../dist/gemini-runner-process.js";

test("buildSpawnArgs includes resume/model/output-format and flattens prompt", () => {
  const result = buildSpawnArgs("gemini-bin", "line-1\nline-2", {
    timeout: 1000,
    resumeSessionId: "session-1",
    model: "gemini-2.5-pro",
    outputFormat: "json",
  });

  if (process.platform === "win32") {
    assert.equal(result.command, "cmd.exe");
    assert.deepEqual(result.args.slice(0, 2), ["/c", "gemini-bin"]);
    assert.deepEqual(result.args.slice(2), [
      "--resume",
      "session-1",
      "-m",
      "gemini-2.5-pro",
      "-p",
      "line-1 line-2",
      "--yolo",
      "--output-format",
      "json",
    ]);
    return;
  }

  assert.equal(result.command, "gemini-bin");
  assert.deepEqual(result.args, [
    "--resume",
    "session-1",
    "-m",
    "gemini-2.5-pro",
    "-p",
    "line-1 line-2",
    "--yolo",
    "--output-format",
    "json",
  ]);
});

test("buildSpawnArgs keeps required baseline arguments when optional fields are missing", () => {
  const result = buildSpawnArgs("gemini-bin", "single prompt", {
    timeout: 1000,
  });

  const tail = process.platform === "win32" ? result.args.slice(2) : result.args;
  assert.deepEqual(tail, ["-p", "single prompt", "--yolo"]);
});