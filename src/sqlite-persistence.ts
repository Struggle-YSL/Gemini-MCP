import path from "node:path";
import type { SQLitePersistenceRuntime } from "./sqlite-persistence-types.js";
import {
  ensureParentDirectory,
  initializeSchema,
  loadSQLiteModule,
  recoverInterruptedTasks,
} from "./sqlite-persistence-db.js";
import { SQLiteOrchestratorStore } from "./sqlite-orchestrator-store.js";
import { SQLiteGeminiSessionStore } from "./sqlite-session-store.js";
import { SQLiteTaskMessageQueue } from "./sqlite-task-message-queue.js";
import { SQLiteTaskStore } from "./sqlite-task-store.js";

export type {
  OrchestratorSnapshot,
  OrchestratorStore,
  PersistOrchestratorSnapshotInput,
  SQLitePersistenceRuntime,
  SQLiteRecoverySummary,
} from "./sqlite-persistence-types.js";

export function createSQLitePersistenceRuntime(
  dbPath?: string,
): SQLitePersistenceRuntime | null {
  const sqlite = loadSQLiteModule();
  if (!sqlite) {
    return null;
  }

  const resolvedDbPath =
    dbPath ?? path.join(process.cwd(), ".gemini-mcp", "state.sqlite");
  ensureParentDirectory(resolvedDbPath);

  const db = new sqlite.DatabaseSync(resolvedDbPath, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });

  initializeSchema(db);
  const recovery = recoverInterruptedTasks(db);

  return {
    taskStore: new SQLiteTaskStore(db),
    taskMessageQueue: new SQLiteTaskMessageQueue(db),
    sessionStore: new SQLiteGeminiSessionStore(db),
    orchestratorStore: new SQLiteOrchestratorStore(db),
    dbPath: resolvedDbPath,
    recovery,
  };
}
