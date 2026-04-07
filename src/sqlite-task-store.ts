import type { Request, RequestId, Result, Task } from "@modelcontextprotocol/sdk/types.js";
import type { CreateTaskOptions, TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { createTaskId, taskRowToTask } from "./sqlite-persistence-db.js";
import type { DatabaseSync, TaskRow } from "./sqlite-persistence-types.js";
import {
  cleanupExpiredTasks,
  ensureTaskCanStoreResult,
  ensureTaskCanTransition,
  getResultExpiresAt,
  getStatusExpiresAt,
  requireTaskRow,
  selectTaskRow,
} from "./sqlite-task-store-helpers.js";

export class SQLiteTaskStore implements TaskStore {
  constructor(private readonly db: DatabaseSync) {}

  async createTask(
    taskParams: CreateTaskOptions,
    requestId: RequestId,
    request: Request,
    _sessionId?: string,
  ): Promise<Task> {
    cleanupExpiredTasks(this.db);

    const taskId = createTaskId();
    const ttl = taskParams.ttl ?? null;
    const createdAt = new Date().toISOString();
    const expiresAt = ttl ? Date.now() + ttl : null;
    const task: Task = {
      taskId,
      status: "working",
      ttl,
      createdAt,
      lastUpdatedAt: createdAt,
      pollInterval: taskParams.pollInterval ?? 1000,
    };

    this.db.prepare(`
      INSERT INTO tasks (
        task_id, status, ttl, expires_at, created_at, last_updated_at,
        poll_interval, status_message, request_id_json, request_json, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
    `).run(
      task.taskId,
      task.status,
      task.ttl,
      expiresAt,
      task.createdAt,
      task.lastUpdatedAt,
      task.pollInterval ?? null,
      JSON.stringify(requestId),
      JSON.stringify(request),
    );

    return task;
  }

  async getTask(taskId: string, _sessionId?: string): Promise<Task | null> {
    cleanupExpiredTasks(this.db);
    const row = selectTaskRow(this.db, taskId);
    return row ? taskRowToTask(row) : null;
  }

  async storeTaskResult(
    taskId: string,
    status: "completed" | "failed",
    result: Result,
    _sessionId?: string,
  ): Promise<void> {
    cleanupExpiredTasks(this.db);
    const row = requireTaskRow(this.db, taskId);
    ensureTaskCanStoreResult(taskId, row);

    const lastUpdatedAt = new Date().toISOString();
    const expiresAt = getResultExpiresAt(row);

    this.db.prepare(`
      UPDATE tasks
      SET status = ?, last_updated_at = ?, expires_at = ?, result_json = ?
      WHERE task_id = ?
    `).run(status, lastUpdatedAt, expiresAt, JSON.stringify(result), taskId);
  }

  async getTaskResult(taskId: string, _sessionId?: string): Promise<Result> {
    cleanupExpiredTasks(this.db);
    const row = this.db.prepare("SELECT result_json FROM tasks WHERE task_id = ?").get(taskId) as { result_json: string | null } | undefined;

    if (!row) {
      throw new Error(`Task with ID ${taskId} not found`);
    }

    if (!row.result_json) {
      throw new Error(`Task ${taskId} has no result stored`);
    }

    return JSON.parse(row.result_json) as Result;
  }

  async updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
    _sessionId?: string,
  ): Promise<void> {
    cleanupExpiredTasks(this.db);
    const row = requireTaskRow(this.db, taskId);
    ensureTaskCanTransition(taskId, row, status);

    const lastUpdatedAt = new Date().toISOString();
    const expiresAt = getStatusExpiresAt(row, status);
    const nextStatusMessage = statusMessage ?? row.status_message;

    this.db.prepare(`
      UPDATE tasks
      SET status = ?, status_message = ?, last_updated_at = ?, expires_at = ?
      WHERE task_id = ?
    `).run(status, nextStatusMessage, lastUpdatedAt, expiresAt, taskId);
  }

  async listTasks(cursor?: string, _sessionId?: string): Promise<{ tasks: Task[]; nextCursor?: string }> {
    cleanupExpiredTasks(this.db);
    const rows = this.db.prepare(`
      SELECT task_id, status, ttl, expires_at, created_at, last_updated_at, poll_interval, status_message, result_json
      FROM tasks ORDER BY created_at, task_id
    `).all() as TaskRow[];
    const pageSize = 10;
    let startIndex = 0;

    if (cursor) {
      const cursorIndex = rows.findIndex((row) => row.task_id === cursor);
      if (cursorIndex < 0) {
        throw new Error(`Invalid cursor: ${cursor}`);
      }
      startIndex = cursorIndex + 1;
    }

    const page = rows.slice(startIndex, startIndex + pageSize);
    const nextCursor = startIndex + pageSize < rows.length ? page[page.length - 1]?.task_id : undefined;

    return {
      tasks: page.map(taskRowToTask),
      nextCursor,
    };
  }
}