import type { GeminiSessionStore, SessionState } from "./session-store.js";
import { deserializeJson } from "./sqlite-persistence-db.js";
import type { DatabaseSync, SessionRow } from "./sqlite-persistence-types.js";

export class SQLiteGeminiSessionStore implements GeminiSessionStore {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly db: DatabaseSync) {
    const rows = this.db.prepare(`
      SELECT id, native_session_id, created_at, updated_at, turns_json
      FROM gemini_sessions ORDER BY updated_at DESC
    `).all() as SessionRow[];

    for (const row of rows) {
      this.sessions.set(row.id, {
        id: row.id,
        nativeSessionId: row.native_session_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        turns: deserializeJson(row.turns_json, []),
      });
    }
  }

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  set(session: SessionState): void {
    this.sessions.set(session.id, session);
    this.db.prepare(`
      INSERT INTO gemini_sessions (id, native_session_id, created_at, updated_at, turns_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        native_session_id = excluded.native_session_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        turns_json = excluded.turns_json
    `).run(
      session.id,
      session.nativeSessionId,
      session.createdAt,
      session.updatedAt,
      JSON.stringify(session.turns),
    );
  }

  delete(id: string): void {
    this.sessions.delete(id);
    this.db.prepare("DELETE FROM gemini_sessions WHERE id = ?").run(id);
  }

  entries(): IterableIterator<[string, SessionState]> {
    return this.sessions.entries();
  }

  size(): number {
    return this.sessions.size;
  }
}
