#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { startServer } from "./index.js";

const CLI_NAME = "gemini-mcp";
const MIN_NODE_MAJOR = 18;

type CliMode = "run" | "help" | "version";

interface CliOptions {
  mode: CliMode;
  skipGeminiCheck: boolean;
}

function readPackageVersion(): string {
  try {
    const raw = readFileSync(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  const message = [
    `${CLI_NAME} - Gemini CLI MCP Server`,
    "",
    "Usage:",
    `  ${CLI_NAME} [options]`,
    "",
    "Options:",
    "  -h, --help               Show help",
    "  -v, --version            Show package version",
    "  --skip-gemini-check      Skip gemini CLI preflight check",
    "",
    "Recommended Codex MCP config:",
    '  command = "npx"',
    `  args = ["-y", "${CLI_NAME}"]`,
  ].join("\n");

  process.stdout.write(`${message}\n`);
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "run",
    skipGeminiCheck: false,
  };

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      options.mode = "help";
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      options.mode = "version";
      continue;
    }
    if (arg === "--skip-gemini-check") {
      options.skipGeminiCheck = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function ensureNodeVersion(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major >= MIN_NODE_MAJOR) {
    return;
  }

  throw new Error(
    `${CLI_NAME} requires Node.js >= ${MIN_NODE_MAJOR}, current: ${process.versions.node}`,
  );
}

function isGeminiCliAvailable(): boolean {
  const configuredGeminiPath = process.env.GEMINI_PATH?.trim();
  if (configuredGeminiPath) {
    return existsSync(configuredGeminiPath);
  }

  const result = spawnSync("gemini", ["--version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function runPreflight(options: CliOptions): void {
  ensureNodeVersion();

  if (options.skipGeminiCheck) {
    return;
  }

  if (isGeminiCliAvailable()) {
    return;
  }

  process.stderr.write(
    "[gemini-mcp] gemini CLI not found in PATH. Install with `npm install -g @google/gemini-cli` and run `gemini` to authenticate.\n",
  );
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.stderr.write(`Run '${CLI_NAME} --help' for usage.\n`);
    process.exitCode = 2;
    return;
  }

  if (options.mode === "help") {
    printHelp();
    return;
  }

  if (options.mode === "version") {
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }

  runPreflight(options);
  await startServer();
}

main().catch((error: unknown) => {
  process.stderr.write(`[${CLI_NAME}] fatal: ${String(error)}\n`);
  process.exit(1);
});
