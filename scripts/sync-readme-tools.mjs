import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildReadmeToolBlock,
  upsertReadmeToolBlock,
} from "./readme-tools-block.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const readmePath = path.join(rootDir, "README.md");
const distManifestPath = path.join(rootDir, "dist", "tool-manifest.js");

let manifestModule;
try {
  manifestModule = await import(pathToFileURL(distManifestPath).href);
} catch (error) {
  console.error(
    "[sync-readme-tools] Failed to load dist/tool-manifest.js. Run npm run build first.",
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const readme = readFileSync(readmePath, "utf8");
const generatedBlock = buildReadmeToolBlock(manifestModule.TOOL_MANIFEST);
const updatedReadme = upsertReadmeToolBlock(readme, generatedBlock);

if (updatedReadme === readme) {
  console.log("[sync-readme-tools] README tool block already up to date.");
  process.exit(0);
}

writeFileSync(readmePath, updatedReadme, "utf8");
console.log(
  "[sync-readme-tools] README tool block updated from tool manifest.",
);
