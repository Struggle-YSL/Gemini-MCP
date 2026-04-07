import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOptionalProjectContextBlock,
  buildPromptFromLines,
  createOptionalProjectContextField,
  sessionIdSchemaField,
} from "../dist/tools/frontend-tool-shared.js";

test("buildPromptFromLines drops non-string and empty lines by default", () => {
  const prompt = buildPromptFromLines([
    "line-1",
    "",
    undefined,
    null,
    false,
    "line-2",
  ]);

  assert.equal(prompt, "line-1\nline-2");
});

test("buildPromptFromLines keeps empty string lines when keepEmptyLines=true", () => {
  const prompt = buildPromptFromLines(["line-1", "", undefined, "line-2"], {
    keepEmptyLines: true,
  });

  assert.equal(prompt, "line-1\n\nline-2");
});

test("buildOptionalProjectContextBlock formats context when provided", () => {
  const contextBlock = buildOptionalProjectContextBlock({
    design_system: "internal-ui",
    conventions: "React + TypeScript",
  });

  assert.match(contextBlock, /Project Context/i);
  assert.match(contextBlock, /Design System: internal-ui/);
  assert.match(contextBlock, /Conventions: React \+ TypeScript/);
  assert.equal(buildOptionalProjectContextBlock(undefined), "");
});

test("shared schema fields validate optional session and optional project context", () => {
  assert.equal(sessionIdSchemaField.safeParse("session-1").success, true);
  assert.equal(sessionIdSchemaField.safeParse(undefined).success, true);
  assert.equal(sessionIdSchemaField.safeParse(123).success, false);

  const projectContextField = createOptionalProjectContextField("test context");
  assert.equal(projectContextField.safeParse(undefined).success, true);
  assert.equal(
    projectContextField.safeParse({ design_system: "internal-ui" }).success,
    true,
  );
  assert.equal(projectContextField.safeParse(123).success, false);
});
