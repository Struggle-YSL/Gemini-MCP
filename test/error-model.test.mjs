import test from "node:test";
import assert from "node:assert/strict";

import {
  createTaskFailureResult,
  extractTaskFailureError,
  normalizeError,
} from "../dist/error-model.js";

test("normalizeError returns normalized unknown meta for generic errors", () => {
  const normalized = normalizeError(new Error("boom"));

  assert.deepEqual(normalized, {
    kind: "unknown",
    message: "boom",
    retryable: false,
  });
});

test("createTaskFailureResult returns structured failed payload", () => {
  const result = createTaskFailureResult(new Error("task failed"));

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent?.status, "failed");
  assert.equal(result.structuredContent?.progress_stage, "failed");
  assert.equal(result.structuredContent?.error?.kind, "unknown");
  assert.equal(result.structuredContent?.error?.message, "task failed");
  assert.equal(result.structuredContent?.error?.retryable, false);
});

test("extractTaskFailureError reads error from structuredContent", () => {
  const result = createTaskFailureResult(new Error("from-structured"));
  const error = extractTaskFailureError(result);

  assert.deepEqual(error, {
    kind: "unknown",
    message: "from-structured",
    retryable: false,
  });
});

test("extractTaskFailureError reads error from text JSON fallback", () => {
  const result = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: "failed",
          progress_stage: "failed",
          error: {
            kind: "timeout",
            message: "timed out",
            retryable: true,
          },
        }),
      },
    ],
  };

  const error = extractTaskFailureError(result);
  assert.deepEqual(error, {
    kind: "timeout",
    message: "timed out",
    retryable: true,
  });
});
