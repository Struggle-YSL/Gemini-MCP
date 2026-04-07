import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  InMemoryTaskMessageQueue,
  InMemoryTaskStore,
} from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import { registerGenerateComponent } from "./tools/generate-component.js";
import { registerCreateStyles } from "./tools/create-styles.js";
import { registerReviewUiDesign } from "./tools/review-ui.js";
import { registerGenerateHtmlStructure } from "./tools/generate-html.js";
import { registerRefactorComponent } from "./tools/refactor-component.js";
import { registerGenerateStorybookStory } from "./tools/generate-storybook.js";
import { registerConvertFramework } from "./tools/convert-framework.js";
import { registerPlanFrontendSolution } from "./tools/plan-frontend-solution.js";
import { registerImplementFrontendTask } from "./tools/implement-frontend-task.js";
import { registerGetRuntimeDiagnostics } from "./tools/get-runtime-diagnostics.js";
import {
  registerApplyOrchestratorResolution,
  registerGetOrchestratorResolution,
} from "./tools/orchestrator-resolution.js";
import {
  registerGetOrchestratorState,
  registerGetOrchestratorSummary,
  registerRunOrchestratorGraph,
} from "./tools/run-orchestrator-graph.js";
import {
  createGeminiTaskSubmitter,
  registerRunOrchestratorLoop,
} from "./tools/run-orchestrator-loop.js";
import { OrchestratorRuntimeManager } from "./orchestrator-runtime-manager.js";
import { createInMemoryGeminiSessionStore } from "./session-store.js";
import { createSQLitePersistenceRuntime } from "./sqlite-persistence.js";
import { RUNTIME_CONFIG } from "./config.js";
import {
  configureGeminiSessionStore,
  log,
  GEMINI,
  getRuntimeDiagnostics,
} from "./gemini-runner.js";
import {
  assertToolManifestIntegrity,
  TOOL_MANIFEST,
  type ToolManifestToolName,
} from "./tool-manifest.js";

const sqlitePersistence = createSQLitePersistenceRuntime(RUNTIME_CONFIG.dbPath);
const taskStore = sqlitePersistence?.taskStore ?? new InMemoryTaskStore();
const taskMessageQueue =
  sqlitePersistence?.taskMessageQueue ?? new InMemoryTaskMessageQueue();
const orchestratorRuntimeManager = sqlitePersistence?.orchestratorStore
  ? new OrchestratorRuntimeManager({
      orchestratorStore: sqlitePersistence.orchestratorStore,
      taskStore,
      geminiTaskSubmitter: createGeminiTaskSubmitter(taskStore),
      maxActiveRuns: RUNTIME_CONFIG.maxActiveOrchestrators,
      tickMs: RUNTIME_CONFIG.orchestratorTickMs,
      maxGeminiRetries: RUNTIME_CONFIG.orchestratorMaxGeminiRetries,
    })
  : undefined;

configureGeminiSessionStore(
  sqlitePersistence?.sessionStore ?? createInMemoryGeminiSessionStore(),
);

const server = new McpServer(
  {
    name: "gemini-frontend",
    version: "1.0.0",
  },
  {
    capabilities: {
      tasks: {
        requests: {
          tools: {
            call: {},
          },
        },
      },
    },
    taskStore,
    taskMessageQueue,
  },
);

const toolRegistrars: Record<ToolManifestToolName, () => void> = {
  generate_frontend_component: () => registerGenerateComponent(server),
  create_styles: () => registerCreateStyles(server),
  review_ui_design: () => registerReviewUiDesign(server),
  generate_html_structure: () => registerGenerateHtmlStructure(server),
  refactor_component: () => registerRefactorComponent(server),
  generate_storybook_story: () => registerGenerateStorybookStory(server),
  convert_framework: () => registerConvertFramework(server),
  plan_frontend_solution: () => registerPlanFrontendSolution(server),
  implement_frontend_task: () => registerImplementFrontendTask(server),
  run_orchestrator_graph: () =>
    registerRunOrchestratorGraph(server, {
      orchestratorStore: sqlitePersistence?.orchestratorStore,
      taskStore,
      runtimeManager: orchestratorRuntimeManager,
    }),
  run_orchestrator_loop: () =>
    registerRunOrchestratorLoop(server, {
      orchestratorStore: sqlitePersistence?.orchestratorStore,
      taskStore,
      runtimeManager: orchestratorRuntimeManager,
    }),
  get_orchestrator_state: () =>
    registerGetOrchestratorState(server, {
      orchestratorStore: sqlitePersistence?.orchestratorStore,
    }),
  get_orchestrator_summary: () =>
    registerGetOrchestratorSummary(server, {
      orchestratorStore: sqlitePersistence?.orchestratorStore,
    }),
  get_runtime_diagnostics: () =>
    registerGetRuntimeDiagnostics(server, {
      sqlitePersistence: sqlitePersistence ?? undefined,
      orchestratorRuntimeManager,
    }),
  get_orchestrator_resolution: () =>
    registerGetOrchestratorResolution(server, {
      orchestratorStore: sqlitePersistence?.orchestratorStore,
    }),
  apply_orchestrator_resolution: () =>
    registerApplyOrchestratorResolution(server, {
      orchestratorStore: sqlitePersistence?.orchestratorStore,
      runtimeManager: orchestratorRuntimeManager,
    }),
};

function registerToolsFromManifest(): void {
  assertToolManifestIntegrity();

  for (const tool of TOOL_MANIFEST) {
    const register = toolRegistrars[tool.name];
    if (!register) {
      throw new Error(
        `Tool '${tool.name}' exists in manifest but has no registrar mapping.`,
      );
    }
    register();
  }
}

registerToolsFromManifest();

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  orchestratorRuntimeManager?.start();
  const diagnostics = getRuntimeDiagnostics();
  const orchestratorDiagnostics = orchestratorRuntimeManager?.getDiagnostics();
  const persistenceMode = sqlitePersistence ? "sqlite" : "memory";
  const runtimeConfigSummary = {
    maxFrontendTasks: RUNTIME_CONFIG.maxFrontendTasks,
    maxActiveOrchestrators: RUNTIME_CONFIG.maxActiveOrchestrators,
    orchestratorTickMs: RUNTIME_CONFIG.orchestratorTickMs,
    orchestratorMaxGeminiRetries: RUNTIME_CONFIG.orchestratorMaxGeminiRetries,
    processTerminationGraceMs: RUNTIME_CONFIG.processTerminationGraceMs,
    processTerminationForceWaitMs: RUNTIME_CONFIG.processTerminationForceWaitMs,
    logLevel: RUNTIME_CONFIG.logLevel,
  };

  if (!sqlitePersistence) {
    log(
      "warn",
      "SQLite persistence unavailable; falling back to in-memory runtime state",
      {
        fix: "Run with Node.js >= 22.5 to enable built-in node:sqlite persistence, or set GEMINI_MCP_DB_PATH explicitly.",
      },
    );
  }

  if (sqlitePersistence?.recovery.interruptedTasksRecovered) {
    log("warn", "Recovered interrupted SQLite tasks after restart", {
      persistenceMode,
      dbPath: sqlitePersistence.dbPath,
      interruptedTasksRecovered:
        sqlitePersistence.recovery.interruptedTasksRecovered,
      clearedQueuedMessages: sqlitePersistence.recovery.clearedQueuedMessages,
    });
  }

  if (GEMINI.execPath) {
    log("info", "Gemini MCP Server ready", {
      execPath: GEMINI.execPath,
      proxySource: diagnostics.proxySource,
      persistenceMode,
      dbPath: sqlitePersistence?.dbPath,
      activeSessions: diagnostics.activeSessions,
      recoveredInterruptedTasks:
        sqlitePersistence?.recovery.interruptedTasksRecovered ?? 0,
      orchestratorRuntime: orchestratorDiagnostics,
      runtimeConfig: runtimeConfigSummary,
      registeredToolCount: TOOL_MANIFEST.length,
    });
  } else {
    log("warn", "Gemini MCP Server started, but gemini CLI not found", {
      searchedIn: GEMINI.globalBinDir,
      searchedPaths: GEMINI.searchedPaths,
      fix: "npm install -g @google/gemini-cli && gemini (complete auth)",
      persistenceMode,
      dbPath: sqlitePersistence?.dbPath,
      recoveredInterruptedTasks:
        sqlitePersistence?.recovery.interruptedTasksRecovered ?? 0,
      orchestratorRuntime: orchestratorDiagnostics,
      runtimeConfig: runtimeConfigSummary,
      registeredToolCount: TOOL_MANIFEST.length,
    });
  }
}

function isExecutedDirectly(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) {
    return false;
  }

  try {
    return (
      path.resolve(entryArg) === path.resolve(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  startServer().catch((err: unknown) => {
    log("error", "Fatal error", { error: String(err) });
    process.exit(1);
  });
}
