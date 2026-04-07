import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tempRoot = path.resolve(rootDir, "test-tmp");
const allowedRoot = path.resolve(rootDir);

if (!tempRoot.startsWith(allowedRoot)) {
  console.error(
    `[clean-test-tmp] Refusing to clean unexpected path: ${tempRoot}`,
  );
  process.exit(1);
}

if (!existsSync(tempRoot)) {
  console.log("[clean-test-tmp] Nothing to clean (test-tmp not found).");
  process.exit(0);
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
console.log(`[clean-test-tmp] Cleaned: ${tempRoot}`);
