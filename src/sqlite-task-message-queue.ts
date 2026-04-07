import type {
  QueuedMessage,
  TaskMessageQueue,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { DatabaseSync } from "./sqlite-persistence-types.js";

export class SQLiteTaskMessageQueue implements TaskMessageQueue {
  constructor(private readonly db: DatabaseSync) {}

  async enqueue(
    taskId: string,
    message: QueuedMessage,
    _sessionId?: string,
    maxSize?: number,
  ): Promise<void> {
    const countRow = this.db
      .prepare("SELECT COUNT(*) AS count FROM task_messages WHERE task_id = ?")
      .get(taskId) as { count: number };
    if (maxSize !== undefined && countRow.count >= maxSize) {
      throw new Error(
        `Task message queue overflow: queue size (${countRow.count}) exceeds maximum (${maxSize})`,
      );
    }

    this.db
      .prepare(
        `
      INSERT INTO task_messages (task_id, message_json, created_at)
      VALUES (?, ?, ?)
    `,
      )
      .run(taskId, JSON.stringify(message), Date.now());
  }

  async dequeue(
    taskId: string,
    _sessionId?: string,
  ): Promise<QueuedMessage | undefined> {
    const row = this.db
      .prepare(
        `
      SELECT id, message_json FROM task_messages
      WHERE task_id = ? ORDER BY id LIMIT 1
    `,
      )
      .get(taskId) as { id: number; message_json: string } | undefined;

    if (!row) {
      return undefined;
    }

    this.db.prepare("DELETE FROM task_messages WHERE id = ?").run(row.id);
    return JSON.parse(row.message_json) as QueuedMessage;
  }

  async dequeueAll(
    taskId: string,
    _sessionId?: string,
  ): Promise<QueuedMessage[]> {
    const rows = this.db
      .prepare(
        `
      SELECT id, message_json FROM task_messages
      WHERE task_id = ? ORDER BY id
    `,
      )
      .all(taskId) as Array<{ id: number; message_json: string }>;

    this.db.prepare("DELETE FROM task_messages WHERE task_id = ?").run(taskId);
    return rows.map((row) => JSON.parse(row.message_json) as QueuedMessage);
  }
}
