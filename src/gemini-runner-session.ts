import { randomUUID } from "node:crypto";
import type {
  GeminiSessionStore,
  SessionState,
  SessionTurn,
} from "./session-store.js";

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SESSION_HISTORY_TURNS = 4;
const SESSION_STORE_TURNS = 12;
const SESSION_CHAR_BUDGET = 48_000;

export interface SessionSelection {
  created: boolean;
  reused: boolean;
  externalLookup: boolean;
  session: SessionState;
}

export function pruneExpiredSessions(
  sessionStore: GeminiSessionStore,
  now = Date.now(),
): void {
  for (const [id, session] of sessionStore.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessionStore.delete(id);
    }
  }
}

function createSessionState(
  sessionStore: GeminiSessionStore,
  id: string = randomUUID(),
  nativeSessionId: string | null = null,
): SessionState {
  const now = Date.now();
  const session: SessionState = {
    id,
    nativeSessionId,
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
  sessionStore.set(session);
  return session;
}

export function getSessionSelection(
  sessionStore: GeminiSessionStore,
  sessionId?: string,
): SessionSelection {
  pruneExpiredSessions(sessionStore);

  if (!sessionId) {
    return {
      created: true,
      reused: false,
      externalLookup: false,
      session: createSessionState(sessionStore),
    };
  }

  const existing = sessionStore.get(sessionId);
  if (existing) {
    existing.updatedAt = Date.now();
    sessionStore.set(existing);
    return {
      created: false,
      reused: true,
      externalLookup: false,
      session: existing,
    };
  }

  return {
    created: true,
    reused: true,
    externalLookup: true,
    session: createSessionState(sessionStore, sessionId, sessionId),
  };
}

export function assignNativeSessionId(
  sessionStore: GeminiSessionStore,
  session: SessionState,
  nativeSessionId: string | null,
): void {
  if (!nativeSessionId) {
    return;
  }

  const previousId = session.id;
  session.nativeSessionId = nativeSessionId;
  session.id = nativeSessionId;
  session.updatedAt = Date.now();

  if (previousId !== nativeSessionId) {
    sessionStore.delete(previousId);
  }

  sessionStore.set(session);
}

function formatSessionTurn(turn: SessionTurn, index: number): string {
  return [
    `Turn ${index}`,
    `Tool: ${turn.toolName}`,
    "User Request:",
    turn.prompt,
    "Assistant Response:",
    turn.response,
  ].join("\n");
}

export function buildSessionPrompt(
  prompt: string,
  toolName: string,
  session: SessionState,
): string {
  if (session.turns.length === 0) {
    return prompt;
  }

  const selected: string[] = [];
  let totalChars = 0;
  let turnNumber = session.turns.length;

  for (let i = session.turns.length - 1; i >= 0; i -= 1) {
    const turnText = formatSessionTurn(session.turns[i], turnNumber);
    if (
      selected.length > 0 &&
      totalChars + turnText.length > SESSION_CHAR_BUDGET
    ) {
      break;
    }

    selected.unshift(turnText);
    totalChars += turnText.length;
    turnNumber -= 1;

    if (selected.length >= SESSION_HISTORY_TURNS) {
      break;
    }
  }

  return [
    "You are continuing an existing Gemini MCP session.",
    `Current tool: ${toolName}`,
    "Use the previous exchanges as authoritative context and keep the response consistent with them.",
    "--- Session History ---",
    selected.join("\n\n"),
    "-----------------------",
    "Current request:",
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function rememberSessionTurn(
  sessionStore: GeminiSessionStore,
  session: SessionState,
  toolName: string,
  prompt: string,
  response: string,
): void {
  session.turns.push({
    toolName,
    prompt,
    response,
    ts: Date.now(),
  });

  if (session.turns.length > SESSION_STORE_TURNS) {
    session.turns.splice(0, session.turns.length - SESSION_STORE_TURNS);
  }

  session.updatedAt = Date.now();
  sessionStore.set(session);
}

export function cleanupFailedSession(
  sessionStore: GeminiSessionStore,
  selection: SessionSelection,
): void {
  if (selection.created && selection.session.turns.length === 0) {
    sessionStore.delete(selection.session.id);
  }
}
