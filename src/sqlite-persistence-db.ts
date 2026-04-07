import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type {
  DatabaseSync,
  RecoveryTaskRow,
  SQLiteModule,
  SQLiteRecoverySummary,
  TableInfoRow,
  TaskRow,
} from "./sqlite-persistence-types.js";

const require = createRequire(import.meta.url);

export function loadSQLiteModule(): SQLiteModule | null {
  try {
    return require("node:sqlite") as SQLiteModule;
  } catch {
    return null;
  }
}

export function ensureParentDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

export function createTaskId(): string {
  return randomBytes(16).toString("hex");
}

export function deserializeJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value) as T;
}

export function taskRowToTask(row: TaskRow): Task {
  return {
    taskId: row.task_id,
    status: row.status,
    ttl: row.ttl,
    createdAt: row.created_at,
    lastUpdatedAt: row.last_updated_at,
    pollInterval: row.poll_interval ?? undefined,
    statusMessage: row.status_message ?? undefined,
  };
}

function ensureTableColumn(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as TableInfoRow[];
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`,
  );
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      ttl INTEGER,
      expires_at INTEGER,
      created_at TEXT NOT NULL,
      last_updated_at TEXT NOT NULL,
      poll_interval INTEGER,
      status_message TEXT,
      request_id_json TEXT NOT NULL,
      request_json TEXT NOT NULL,
      result_json TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS task_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      message_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON task_messages(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_tasks_expires_at ON tasks(expires_at);

    CREATE TABLE IF NOT EXISTS gemini_sessions (
      id TEXT PRIMARY KEY,
      native_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      turns_json TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_gemini_sessions_updated_at ON gemini_sessions(updated_at);

    CREATE TABLE IF NOT EXISTS orchestrator_snapshots (
      orchestrator_id TEXT PRIMARY KEY,
      graph_json TEXT NOT NULL,
      state_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      context_json TEXT,
      runtime_json TEXT,
      events_json TEXT,
      final_summary_json TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_orchestrator_snapshots_updated_at ON orchestrator_snapshots(updated_at DESC);
  `);

  ensureTableColumn(db, "orchestrator_snapshots", "context_json", "TEXT");
  ensureTableColumn(db, "orchestrator_snapshots", "runtime_json", "TEXT");
  ensureTableColumn(db, "orchestrator_snapshots", "events_json", "TEXT");
  ensureTableColumn(db, "orchestrator_snapshots", "final_summary_json", "TEXT");
}

export function recoverInterruptedTasks(
  db: DatabaseSync,
): SQLiteRecoverySummary {
  const rows = db
    .prepare(
      `
    SELECT task_id, status, ttl
    FROM tasks
    WHERE status NOT IN ('completed', 'failed', 'cancelled')
  `,
    )
    .all() as RecoveryTaskRow[];

  if (rows.length === 0) {
    return {
      interruptedTasksRecovered: 0,
      clearedQueuedMessages: 0,
    };
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const updateTask = db.prepare(`
    UPDATE tasks
    SET status = 'failed',
        status_message = ?,
        last_updated_at = ?,
        expires_at = ?
    WHERE task_id = ?
  `);
  const countMessages = db.prepare(`
    SELECT COUNT(*) AS count FROM task_messages WHERE task_id = ?
  `);
  const deleteMessages = db.prepare(`
    DELETE FROM task_messages WHERE task_id = ?
  `);

  let clearedQueuedMessages = 0;

  for (const row of rows) {
    const statusMessage = `Task interrupted by server restart before completion (previous status: ${row.status}).`;
    const expiresAt = row.ttl ? nowMs + row.ttl : null;
    updateTask.run(statusMessage, nowIso, expiresAt, row.task_id);

    const pendingMessages = countMessages.get(row.task_id) as { count: number };
    clearedQueuedMessages += pendingMessages.count;
    deleteMessages.run(row.task_id);
  }

  return {
    interruptedTasksRecovered: rows.length,
    clearedQueuedMessages,
  };
}
