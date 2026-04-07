import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

export interface GeminiResolution {
  /** gemini 可执行文件完整路径，找不到时为 null */
  execPath: string | null;
  /** 首个候选 bin 目录（用于向后兼容日志字段） */
  globalBinDir: string;
  /** 路径探测过程中扫描过的候选目录（按优先级排序） */
  searchedPaths: string[];
}

export interface GeminiDiscoveryContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  pathExists: (filePath: string) => boolean;
  runCommand: (
    command: string,
    args: string[],
    timeoutMs?: number,
  ) => string | null;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 5000;

function createDefaultCommandRunner(): GeminiDiscoveryContext["runCommand"] {
  return (command, args, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) => {
    try {
      const result = spawnSync(command, args, {
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
      });

      if (result.status !== 0 || typeof result.stdout !== "string") {
        return null;
      }

      const output = result.stdout.trim();
      return output.length > 0 ? output : null;
    } catch {
      return null;
    }
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function splitCommandOutputLines(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("INFO:"));
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getPathApi(
  platform: NodeJS.Platform,
): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

function getPathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function looksLikeGeminiBinary(
  filePath: string,
  platform: NodeJS.Platform,
): boolean {
  const pathApi = getPathApi(platform);
  const name = pathApi.basename(filePath).toLowerCase();
  if (platform === "win32") {
    return (
      name === "gemini" ||
      name === "gemini.cmd" ||
      name === "gemini.exe" ||
      name === "gemini.ps1"
    );
  }
  return name === "gemini";
}

function buildExecutableCandidates(
  binDir: string,
  platform: NodeJS.Platform,
): string[] {
  const pathApi = getPathApi(platform);
  if (platform === "win32") {
    return [
      pathApi.join(binDir, "gemini.cmd"),
      pathApi.join(binDir, "gemini.exe"),
      pathApi.join(binDir, "gemini.ps1"),
      pathApi.join(binDir, "gemini"),
    ];
  }

  return [pathApi.join(binDir, "gemini")];
}

function collectPathEnvDirectories(context: GeminiDiscoveryContext): string[] {
  const pathValue = context.env.PATH ?? context.env.Path ?? context.env.path;
  if (!pathValue) {
    return [];
  }

  return dedupe(
    pathValue
      .split(getPathDelimiter(context.platform))
      .map((segment) => stripWrappingQuotes(segment))
      .filter(Boolean),
  );
}

function collectCommonFallbackDirectories(
  context: GeminiDiscoveryContext,
): string[] {
  const pathApi = getPathApi(context.platform);

  if (context.platform === "win32") {
    return dedupe(
      [
        context.env.APPDATA ? pathApi.join(context.env.APPDATA, "npm") : "",
        context.env.LOCALAPPDATA
          ? pathApi.join(context.env.LOCALAPPDATA, "npm")
          : "",
      ].filter(Boolean),
    );
  }

  const home = context.env.HOME ?? "";
  return dedupe(
    [
      "/usr/local/bin",
      "/usr/bin",
      "/opt/homebrew/bin",
      "/opt/local/bin",
      home ? pathApi.join(home, ".local", "bin") : "",
      home ? pathApi.join(home, "bin") : "",
      home ? pathApi.join(home, ".npm-global", "bin") : "",
      home ? pathApi.join(home, ".volta", "bin") : "",
      home ? pathApi.join(home, ".asdf", "shims") : "",
      home ? pathApi.join(home, ".yarn", "bin") : "",
      home
        ? pathApi.join(
            home,
            ".config",
            "yarn",
            "global",
            "node_modules",
            ".bin",
          )
        : "",
    ].filter(Boolean),
  );
}

function collectNpmGlobalBinDirs(context: GeminiDiscoveryContext): string[] {
  const pathApi = getPathApi(context.platform);
  const npmCommands =
    context.platform === "win32" ? ["npm.cmd", "npm"] : ["npm"];

  const dirs: string[] = [];
  for (const npmCmd of npmCommands) {
    const prefix = context.runCommand(npmCmd, ["config", "get", "prefix"]);
    const normalizedPrefix = stripWrappingQuotes(prefix ?? "");
    if (!normalizedPrefix || normalizedPrefix.toLowerCase() === "undefined") {
      continue;
    }

    dirs.push(
      context.platform === "win32"
        ? normalizedPrefix
        : pathApi.join(normalizedPrefix, "bin"),
    );
  }

  return dedupe(dirs);
}

function collectPackageManagerGlobalBinDirs(
  context: GeminiDiscoveryContext,
): string[] {
  const commandCandidates = (baseName: string): string[] =>
    context.platform === "win32" ? [`${baseName}.cmd`, baseName] : [baseName];

  const dirs: string[] = [];

  for (const pnpmCmd of commandCandidates("pnpm")) {
    dirs.push(
      ...splitCommandOutputLines(context.runCommand(pnpmCmd, ["bin", "-g"])),
    );
  }

  for (const yarnCmd of commandCandidates("yarn")) {
    dirs.push(
      ...splitCommandOutputLines(
        context.runCommand(yarnCmd, ["global", "bin"]),
      ),
    );
  }

  return dedupe(dirs.map((value) => stripWrappingQuotes(value)));
}

interface DirectLookupResolution {
  execPath: string | null;
  candidateDirs: string[];
}

function resolveGeminiFromSystemLookup(
  context: GeminiDiscoveryContext,
): DirectLookupResolution {
  const lookupOutput =
    context.platform === "win32"
      ? context.runCommand("where", ["gemini"])
      : context.runCommand("which", ["gemini"]);
  const lines = splitCommandOutputLines(lookupOutput).map((line) =>
    stripWrappingQuotes(line),
  );
  const pathApi = getPathApi(context.platform);

  for (const line of lines) {
    if (!looksLikeGeminiBinary(line, context.platform)) {
      continue;
    }

    if (context.pathExists(line)) {
      return {
        execPath: line,
        candidateDirs: dedupe(lines.map((item) => pathApi.dirname(item))),
      };
    }
  }

  return {
    execPath: null,
    candidateDirs: dedupe(lines.map((line) => pathApi.dirname(line))),
  };
}

export function resolveGeminiWithContext(
  context: GeminiDiscoveryContext,
): GeminiResolution {
  const pathApi = getPathApi(context.platform);
  const configuredPath = stripWrappingQuotes(context.env.GEMINI_PATH ?? "");

  if (configuredPath && context.pathExists(configuredPath)) {
    return {
      execPath: configuredPath,
      globalBinDir: pathApi.dirname(configuredPath),
      searchedPaths: [pathApi.dirname(configuredPath)],
    };
  }

  const lookup = resolveGeminiFromSystemLookup(context);
  if (lookup.execPath) {
    return {
      execPath: lookup.execPath,
      globalBinDir: pathApi.dirname(lookup.execPath),
      searchedPaths: dedupe([
        pathApi.dirname(lookup.execPath),
        ...lookup.candidateDirs,
      ]),
    };
  }

  const candidateDirs = dedupe([
    ...lookup.candidateDirs,
    ...collectNpmGlobalBinDirs(context),
    ...collectPackageManagerGlobalBinDirs(context),
    ...collectPathEnvDirectories(context),
    ...collectCommonFallbackDirectories(context),
  ]);

  for (const dir of candidateDirs) {
    for (const candidate of buildExecutableCandidates(dir, context.platform)) {
      if (context.pathExists(candidate)) {
        return {
          execPath: candidate,
          globalBinDir: dir,
          searchedPaths: candidateDirs,
        };
      }
    }
  }

  return {
    execPath: null,
    globalBinDir: candidateDirs[0] ?? "",
    searchedPaths: candidateDirs,
  };
}

export function resolveGemini(): GeminiResolution {
  return resolveGeminiWithContext({
    platform: process.platform,
    env: process.env,
    pathExists: existsSync,
    runCommand: createDefaultCommandRunner(),
  });
}
