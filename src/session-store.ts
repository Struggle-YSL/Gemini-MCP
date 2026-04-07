export interface SessionTurn {
  toolName: string;
  prompt: string;
  response: string;
  ts: number;
}

export interface SessionState {
  id: string;
  nativeSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  turns: SessionTurn[];
}

export interface GeminiSessionStore {
  get(id: string): SessionState | undefined;
  set(session: SessionState): void;
  delete(id: string): void;
  entries(): IterableIterator<[string, SessionState]>;
  size(): number;
}

class InMemoryGeminiSessionStore implements GeminiSessionStore {
  private readonly sessions = new Map<string, SessionState>();

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  set(session: SessionState): void {
    this.sessions.set(session.id, session);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  entries(): IterableIterator<[string, SessionState]> {
    return this.sessions.entries();
  }

  size(): number {
    return this.sessions.size;
  }
}

export function createInMemoryGeminiSessionStore(): GeminiSessionStore {
  return new InMemoryGeminiSessionStore();
}
