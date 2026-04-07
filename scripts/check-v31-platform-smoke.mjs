import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  readFileSync(path.join(rootDir, "package.json"), "utf8"),
);
const packageName =
  typeof packageJson.name === "string" ? packageJson.name : "gemini-mcp";
const packageVersion =
  typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const workspaceRoot = path.join(rootDir, "test-tmp", "v31-smoke", timestamp);
const projectDependencyDir = path.join(workspaceRoot, "project-dependency");
const globalPrefixDir = path.join(workspaceRoot, "global-prefix");
const reportPath = path.join(workspaceRoot, "v31-smoke-report.json");

function fail(message) {
  console.error(`[check-v31-platform-smoke] ${message}`);
  process.exit(1);
}

function toCommandString(command, args) {
  return [command, ...args].join(" ");
}

function quoteForCmdArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runViaWindowsCmd(command, args, options = {}) {
  const commandLine = [command, ...args.map((arg) => quoteForCmdArg(arg))].join(
    " ",
  );
  return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function run(command, args, options = {}) {
  const result =
    process.platform === "win32"
      ? runViaWindowsCmd(command, args, options)
      : spawnSync(command, args, {
          cwd: options.cwd ?? rootDir,
          encoding: "utf8",
          shell: false,
          windowsHide: true,
        });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const status = typeof result.status === "number" ? result.status : -1;
  const spawnError = result.error ? String(result.error) : "";

  if (status !== 0) {
    const commandLine = toCommandString(command, args);
    fail(
      `command failed (exit=${status}): ${commandLine}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}${spawnError ? `\n--- spawn error ---\n${spawnError}` : ""}`,
    );
  }

  return { stdout, stderr, status };
}

function parseTarballArg() {
  const prefix = "--tarball=";
  const rawArg = process.argv.find((arg) => arg.startsWith(prefix));
  if (!rawArg) {
    return null;
  }

  const inputPath = rawArg.slice(prefix.length).trim();
  if (!inputPath) {
    fail("--tarball= requires a non-empty file path.");
  }

  const resolved = path.resolve(process.cwd(), inputPath);
  if (!existsSync(resolved)) {
    fail(`tarball not found: ${resolved}`);
  }

  return resolved;
}

function resolveTarballPath() {
  const explicitTarball = parseTarballArg();
  if (explicitTarball) {
    return explicitTarball;
  }

  const { stdout } = run(npmCmd, ["pack", "--json"], { cwd: rootDir });
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`failed to parse npm pack output: ${message}`);
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const filename = typeof entry?.filename === "string" ? entry.filename : null;

  if (!filename) {
    fail("npm pack output missing filename.");
  }

  const resolved = path.resolve(rootDir, filename);
  if (!existsSync(resolved)) {
    fail(`npm pack reported tarball but file does not exist: ${resolved}`);
  }

  return resolved;
}

function ensureWorkspace() {
  mkdirSync(workspaceRoot, { recursive: true });
}

function runScenarioNpx(tarballPath) {
  const steps = [];
  steps.push({
    command: toCommandString(npxCmd, [
      "--yes",
      "--package",
      tarballPath,
      "gemini-mcp",
      "--version",
    ]),
    ...run(
      npxCmd,
      ["--yes", "--package", tarballPath, "gemini-mcp", "--version"],
      { cwd: rootDir },
    ),
  });
  steps.push({
    command: toCommandString(npxCmd, [
      "--yes",
      "--package",
      tarballPath,
      "gemini-mcp",
      "--help",
    ]),
    ...run(
      npxCmd,
      ["--yes", "--package", tarballPath, "gemini-mcp", "--help"],
      { cwd: rootDir },
    ),
  });
  return steps;
}

function runScenarioGlobalInstall(tarballPath) {
  const steps = [];
  steps.push({
    command: toCommandString(npmCmd, [
      "install",
      "-g",
      tarballPath,
      "--prefix",
      globalPrefixDir,
    ]),
    ...run(
      npmCmd,
      ["install", "-g", tarballPath, "--prefix", globalPrefixDir],
      { cwd: rootDir },
    ),
  });

  const globalCliPath =
    process.platform === "win32"
      ? path.join(globalPrefixDir, "gemini-mcp.cmd")
      : path.join(globalPrefixDir, "bin", "gemini-mcp");

  if (!existsSync(globalCliPath)) {
    fail(`global install did not produce cli executable: ${globalCliPath}`);
  }

  steps.push({
    command: toCommandString(globalCliPath, ["--version"]),
    ...run(globalCliPath, ["--version"], { cwd: rootDir }),
  });
  steps.push({
    command: toCommandString(globalCliPath, ["--help"]),
    ...run(globalCliPath, ["--help"], { cwd: rootDir }),
  });

  return { steps, globalCliPath };
}

function runScenarioProjectDependency(tarballPath) {
  mkdirSync(projectDependencyDir, { recursive: true });
  const steps = [];

  steps.push({
    command: toCommandString(npmCmd, ["init", "-y"]),
    ...run(npmCmd, ["init", "-y"], { cwd: projectDependencyDir }),
  });

  steps.push({
    command: toCommandString(npmCmd, ["install", "-D", tarballPath]),
    ...run(npmCmd, ["install", "-D", tarballPath], {
      cwd: projectDependencyDir,
    }),
  });

  const projectCliPath = path.join(
    projectDependencyDir,
    "node_modules",
    "gemini-mcp",
    "dist",
    "cli.js",
  );
  if (!existsSync(projectCliPath)) {
    fail(`project dependency install missing cli entry: ${projectCliPath}`);
  }

  steps.push({
    command: toCommandString(process.execPath, [projectCliPath, "--version"]),
    ...run(process.execPath, [projectCliPath, "--version"], {
      cwd: projectDependencyDir,
    }),
  });

  steps.push({
    command: toCommandString(process.execPath, [projectCliPath, "--help"]),
    ...run(process.execPath, [projectCliPath, "--help"], {
      cwd: projectDependencyDir,
    }),
  });

  return { steps, projectCliPath };
}

function summarizeSteps(steps) {
  return steps.map((step) => ({
    command: step.command,
    status: step.status,
    stdout: step.stdout.trim(),
    stderr: step.stderr.trim(),
  }));
}

function cleanupWorkspace() {
  if (!process.argv.includes("--cleanup-temp")) {
    return false;
  }

  const normalizedWorkspace = path.resolve(workspaceRoot);
  const normalizedAllowedRoot = path.resolve(path.join(rootDir, "test-tmp"));
  if (!normalizedWorkspace.startsWith(normalizedAllowedRoot)) {
    fail(`refusing to clean up unsafe path: ${normalizedWorkspace}`);
  }

  rmSync(workspaceRoot, { recursive: true, force: true });
  return true;
}

function main() {
  ensureWorkspace();
  const tarballPath = resolveTarballPath();

  const npxSteps = runScenarioNpx(tarballPath);
  const globalResult = runScenarioGlobalInstall(tarballPath);
  const projectResult = runScenarioProjectDependency(tarballPath);

  const report = {
    checked_at: new Date().toISOString(),
    platform: process.platform,
    package: {
      name: packageName,
      version: packageVersion,
      tarball: tarballPath,
    },
    scenarios: {
      npx: summarizeSteps(npxSteps),
      global_install: {
        cli_path: globalResult.globalCliPath,
        steps: summarizeSteps(globalResult.steps),
      },
      project_dependency: {
        cli_path: projectResult.projectCliPath,
        steps: summarizeSteps(projectResult.steps),
      },
    },
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const cleaned = cleanupWorkspace();

  console.log(
    `[check-v31-platform-smoke] OK: all scenarios passed on ${process.platform}.`,
  );
  if (cleaned) {
    console.log(
      "[check-v31-platform-smoke] Workspace cleaned (--cleanup-temp); report file removed.",
    );
  } else {
    console.log(`[check-v31-platform-smoke] Report: ${reportPath}`);
  }
}

main();
