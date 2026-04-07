import { isTerminal } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type { DatabaseSync, TaskRow } from "./sqlite-persistence-types.js";

export function cleanupExpiredTasks(db: DatabaseSync, now = Date.now()): void {
  db.prepare("DELETE FROM tasks WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now);
}

export function selectTaskRow(db: DatabaseSync, taskId: string): TaskRow | undefined {
  return db.prepare(`
    SELECT task_id, status, ttl, expires_at, created_at, last_updated_at, poll_interval, status_message, result_json
    FROM tasks WHERE task_id = ?
  `).get(taskId) as TaskRow | undefined;
}

export function requireTaskRow(db: DatabaseSync, taskId: string): TaskRow {
  const row = selectTaskRow(db, taskId);
  if (!row) {
    throw new Error(`Task with ID ${taskId} not found`);
  }

  return row;
}

export function ensureTaskCanStoreResult(taskId: string, row: TaskRow): void {
  if (isTerminal(row.status)) {
    throw new Error(`Cannot store result for task ${taskId} in terminal status '${row.status}'. Task results can only be stored once.`);
  }
}

export function ensureTaskCanTransition(
  taskId: string,
  row: TaskRow,
  nextStatus: Task["status"],
): void {
  if (isTerminal(row.status)) {
    throw new Error(`Cannot update task ${taskId} from terminal status '${row.status}' to '${nextStatus}'. Terminal states cannot transition.`);
  }
}

export function getResultExpiresAt(row: TaskRow, nowMs = Date.now()): number | null {
  return row.ttl ? nowMs + row.ttl : row.expires_at;
}

export function getStatusExpiresAt(
  row: TaskRow,
  status: Task["status"],
  nowMs = Date.now(),
): number | null {
  return isTerminal(status) && row.ttl ? nowMs + row.ttl : row.expires_at;
}