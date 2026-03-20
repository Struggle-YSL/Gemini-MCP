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
import { log, GEMINI, getRuntimeDiagnostics } from "./gemini-runner.js";

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
    taskStore: new InMemoryTaskStore(),
    taskMessageQueue: new InMemoryTaskMessageQueue(),
  }
);

registerGenerateComponent(server);
registerCreateStyles(server);
registerReviewUiDesign(server);
registerGenerateHtmlStructure(server);
registerRefactorComponent(server);
registerGenerateStorybookStory(server);
registerConvertFramework(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const diagnostics = getRuntimeDiagnostics();

  if (GEMINI.execPath) {
    log("info", "Gemini MCP Server ready", {
      execPath: GEMINI.execPath,
      proxySource: diagnostics.proxySource,
    });
  } else {
    log("warn", "Gemini MCP Server started, but gemini CLI not found", {
      searchedIn: GEMINI.globalBinDir,
      fix: "npm install -g @google/gemini-cli && gemini (complete auth)",
    });
  }
}

main().catch((err: unknown) => {
  log("error", "Fatal error", { error: String(err) });
  process.exit(1);
});
