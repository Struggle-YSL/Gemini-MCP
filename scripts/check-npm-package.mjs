import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(rootDir, "dist", "cli.js");
const indexPath = path.join(rootDir, "dist", "index.js");

function fail(message) {
  console.error(`[check-npm-package] ${message}`);
  process.exit(1);
}

if (!existsSync(cliPath)) {
  fail("dist/cli.js not found. Run npm run build first.");
}

if (!existsSync(indexPath)) {
  fail("dist/index.js not found. Run npm run build first.");
}

const cliHead = readFileSync(cliPath, "utf8").slice(0, 80);
if (!cliHead.startsWith("#!/usr/bin/env node")) {
  fail("dist/cli.js is missing shebang '#!/usr/bin/env node'.");
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
let packResultRaw = "";
try {
  packResultRaw = execSync(`${npmCmd} pack --dry-run --json`, {
    cwd: rootDir,
    encoding: "utf8",
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`failed to run 'npm pack --dry-run --json': ${message}`);
}

let packReport;
try {
  const parsed = JSON.parse(packResultRaw.trim());
  packReport = Array.isArray(parsed) ? parsed[0] : parsed;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`failed to parse npm pack JSON output: ${message}`);
}

const files = Array.isArray(packReport?.files)
  ? packReport.files
      .map((item) => item?.path)
      .filter((value) => typeof value === "string")
  : [];

if (files.length === 0) {
  fail("npm pack report does not contain file list.");
}

const requiredFiles = [
  "README.md",
  "package.json",
  "dist/cli.js",
  "dist/index.js",
];
const missing = requiredFiles.filter((required) => !files.includes(required));
if (missing.length > 0) {
  fail(`package is missing required files: ${missing.join(", ")}`);
}

const allowedPrefixes = ["dist/"];
const allowedExact = new Set(["README.md", "package.json"]);
const unexpectedFiles = files.filter((filePath) => {
  if (allowedExact.has(filePath)) {
    return false;
  }
  return !allowedPrefixes.some((prefix) => filePath.startsWith(prefix));
});

if (unexpectedFiles.length > 0) {
  fail(`package includes unexpected files: ${unexpectedFiles.join(", ")}`);
}

console.log(
  `[check-npm-package] OK: ${files.length} files in dry-run package; cli entry + layout validated.`,
);
