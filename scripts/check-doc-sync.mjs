import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildReadmeToolBlock,
  extractReadmeToolBlock,
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
    "[check-doc-sync] Failed to load dist/tool-manifest.js. Run npm run build first.",
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const manifest = manifestModule.TOOL_MANIFEST;
const readme = readFileSync(readmePath, "utf8");
const actualBlock = extractReadmeToolBlock(readme);
const expectedBlock = buildReadmeToolBlock(manifest);

if (!actualBlock) {
  console.error(
    "[check-doc-sync] README is missing the auto-generated tool block.",
  );
  console.error("- Run: npm run sync:readme-tools");
  process.exit(1);
}

const normalize = (value) => value.replace(/\r\n/g, "\n").trim();
if (normalize(actualBlock) !== normalize(expectedBlock)) {
  console.error(
    "[check-doc-sync] README auto-generated tool block is out of sync with src/tool-manifest.ts.",
  );
  console.error("- Run: npm run sync:readme-tools");
  process.exit(1);
}

const missingToolSections = manifest
  .map((tool) => tool.name)
  .filter((name) => !readme.includes(`### \`${name}\``));

if (missingToolSections.length > 0) {
  console.error(
    "[check-doc-sync] README is missing detailed sections for manifest tools.",
  );
  console.error(`- Missing sections: ${missingToolSections.join(", ")}`);
  process.exit(1);
}

console.log(
  `[check-doc-sync] OK: README generated block + tool sections match manifest (${manifest.length} tools).`,
);
