import type { GeminiToolResult } from "./gemini-runner.js";

export function createSessionAwareToolResult(result: GeminiToolResult) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    structuredContent: {
      session_id: result.sessionId,
      session_reused: result.sessionReused,
    },
  };
}
