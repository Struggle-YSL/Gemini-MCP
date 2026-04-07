import { spawnSync } from "node:child_process";

export type ProxySource =
  | "env"
  | "windows-registry"
  | "macos-scutil"
  | "linux-gsettings"
  | "none";

export interface ResolvedProxyEnv {
  env: Record<string, string>;
  source: ProxySource;
}

export interface ProxyResolverContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  runCommand: (
    command: string,
    args: string[],
    timeoutMs?: number,
  ) => string | null;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 5000;

function createDefaultCommandRunner(): ProxyResolverContext["runCommand"] {
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

function pickEnv(
  env: NodeJS.ProcessEnv,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeProxyUrl(value: string): string {
  const trimmed = value.trim();
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function buildProxyEnv(
  httpProxy: string,
  httpsProxy: string,
  noProxy?: string,
): Record<string, string> {
  const normalizedHttpProxy = normalizeProxyUrl(httpProxy);
  const normalizedHttpsProxy = normalizeProxyUrl(httpsProxy);

  const result: Record<string, string> = {
    HTTP_PROXY: normalizedHttpProxy,
    http_proxy: normalizedHttpProxy,
    HTTPS_PROXY: normalizedHttpsProxy,
    https_proxy: normalizedHttpsProxy,
  };

  const normalizedNoProxy = noProxy?.trim();
  if (normalizedNoProxy) {
    result.NO_PROXY = normalizedNoProxy;
    result.no_proxy = normalizedNoProxy;
  }

  return result;
}

function parseWindowsProxyServer(raw: string): {
  httpProxy?: string;
  httpsProxy?: string;
} {
  const value = raw.trim();
  if (!value) {
    return {};
  }

  if (!value.includes("=")) {
    const normalized = normalizeProxyUrl(value);
    return { httpProxy: normalized, httpsProxy: normalized };
  }

  const entries = Object.fromEntries(
    value
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [protocol, address] = item.split("=", 2);
        return [protocol.toLowerCase(), normalizeProxyUrl(address)];
      }),
  );

  const httpProxy = entries.http ?? entries.https;
  const httpsProxy = entries.https ?? entries.http;
  return { httpProxy, httpsProxy };
}

function resolveWindowsRegistryProxy(context: ProxyResolverContext): {
  httpProxy?: string;
  httpsProxy?: string;
} {
  if (context.platform !== "win32") {
    return {};
  }

  const key =
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
  const enabled = context.runCommand("reg", [
    "query",
    key,
    "/v",
    "ProxyEnable",
  ]);

  if (!enabled || !/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) {
    return {};
  }

  const server = context.runCommand("reg", ["query", key, "/v", "ProxyServer"]);
  if (!server) {
    return {};
  }

  const match = server.match(/ProxyServer\s+REG_\w+\s+([^\r\n]+)/i);
  return match ? parseWindowsProxyServer(match[1]) : {};
}

function parseScutilField(raw: string, field: string): string | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(
    new RegExp(`${escapedField}\\s*:\\s*([^\\r\\n]+)`, "i"),
  );
  return match?.[1]?.trim();
}

function parseProxyPort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const match = raw.match(/\d+/);
  if (!match) {
    return undefined;
  }

  const port = Number.parseInt(match[0], 10);
  return Number.isFinite(port) && port > 0 ? port : undefined;
}

function normalizeHostWithPort(host: string, port?: number): string {
  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return "";
  }

  if (/^[a-z]+:\/\//i.test(trimmedHost)) {
    return trimmedHost;
  }

  if (typeof port === "number" && port > 0 && !trimmedHost.includes(":")) {
    return `http://${trimmedHost}:${port}`;
  }

  return `http://${trimmedHost}`;
}

function resolveMacosScutilProxy(context: ProxyResolverContext): {
  httpProxy?: string;
  httpsProxy?: string;
} {
  if (context.platform !== "darwin") {
    return {};
  }

  const output = context.runCommand("scutil", ["--proxy"]);
  if (!output) {
    return {};
  }

  const httpEnabled = parseScutilField(output, "HTTPEnable") === "1";
  const httpsEnabled = parseScutilField(output, "HTTPSEnable") === "1";

  const httpHost = parseScutilField(output, "HTTPProxy");
  const httpsHost = parseScutilField(output, "HTTPSProxy");
  const httpPort = parseProxyPort(parseScutilField(output, "HTTPPort"));
  const httpsPort = parseProxyPort(parseScutilField(output, "HTTPSPort"));

  const httpProxy =
    httpEnabled && httpHost
      ? normalizeHostWithPort(httpHost, httpPort)
      : undefined;
  const httpsProxy =
    httpsEnabled && httpsHost
      ? normalizeHostWithPort(httpsHost, httpsPort)
      : undefined;

  return {
    httpProxy,
    httpsProxy,
  };
}

function stripGsettingsString(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed === "''") {
    return undefined;
  }

  const unquoted = trimmed.replace(/^'(.*)'$/, "$1").trim();
  return unquoted.length > 0 ? unquoted : undefined;
}

function readGsettings(
  context: ProxyResolverContext,
  schema: string,
  key: string,
): string | undefined {
  const value = context.runCommand("gsettings", ["get", schema, key], 3000);
  return stripGsettingsString(value ?? undefined);
}

function resolveLinuxGsettingsProxy(context: ProxyResolverContext): {
  httpProxy?: string;
  httpsProxy?: string;
} {
  if (context.platform !== "linux") {
    return {};
  }

  const mode = readGsettings(context, "org.gnome.system.proxy", "mode");
  if (!mode || mode.toLowerCase() !== "manual") {
    return {};
  }

  const httpHost = readGsettings(
    context,
    "org.gnome.system.proxy.http",
    "host",
  );
  const httpPort = parseProxyPort(
    readGsettings(context, "org.gnome.system.proxy.http", "port"),
  );
  const httpsHost = readGsettings(
    context,
    "org.gnome.system.proxy.https",
    "host",
  );
  const httpsPort = parseProxyPort(
    readGsettings(context, "org.gnome.system.proxy.https", "port"),
  );
  const socksHost = readGsettings(
    context,
    "org.gnome.system.proxy.socks",
    "host",
  );
  const socksPort = parseProxyPort(
    readGsettings(context, "org.gnome.system.proxy.socks", "port"),
  );

  const httpProxy = httpHost
    ? normalizeHostWithPort(httpHost, httpPort)
    : socksHost
      ? normalizeHostWithPort(socksHost, socksPort)
      : undefined;

  const httpsProxy = httpsHost
    ? normalizeHostWithPort(httpsHost, httpsPort)
    : socksHost
      ? normalizeHostWithPort(socksHost, socksPort)
      : undefined;

  return {
    httpProxy,
    httpsProxy,
  };
}

export function resolveProxyEnvWithContext(
  context: ProxyResolverContext,
): ResolvedProxyEnv {
  const noProxy = pickEnv(context.env, "NO_PROXY", "no_proxy");

  const envHttpProxy = pickEnv(context.env, "HTTP_PROXY", "http_proxy");
  const envHttpsProxy = pickEnv(context.env, "HTTPS_PROXY", "https_proxy");

  if (envHttpProxy || envHttpsProxy) {
    const httpProxy = envHttpProxy ?? envHttpsProxy!;
    const httpsProxy = envHttpsProxy ?? envHttpProxy!;
    return {
      source: "env",
      env: buildProxyEnv(httpProxy, httpsProxy, noProxy),
    };
  }

  const allProxy = pickEnv(context.env, "ALL_PROXY", "all_proxy");
  if (allProxy) {
    const normalized = normalizeProxyUrl(allProxy);
    return {
      source: "env",
      env: {
        ...buildProxyEnv(normalized, normalized, noProxy),
        ALL_PROXY: normalized,
        all_proxy: normalized,
      },
    };
  }

  const windowsProxy = resolveWindowsRegistryProxy(context);
  if (windowsProxy.httpProxy || windowsProxy.httpsProxy) {
    const httpProxy = windowsProxy.httpProxy ?? windowsProxy.httpsProxy!;
    const httpsProxy = windowsProxy.httpsProxy ?? windowsProxy.httpProxy!;
    return {
      source: "windows-registry",
      env: buildProxyEnv(httpProxy, httpsProxy, noProxy),
    };
  }

  const macosProxy = resolveMacosScutilProxy(context);
  if (macosProxy.httpProxy || macosProxy.httpsProxy) {
    const httpProxy = macosProxy.httpProxy ?? macosProxy.httpsProxy!;
    const httpsProxy = macosProxy.httpsProxy ?? macosProxy.httpProxy!;
    return {
      source: "macos-scutil",
      env: buildProxyEnv(httpProxy, httpsProxy, noProxy),
    };
  }

  const linuxProxy = resolveLinuxGsettingsProxy(context);
  if (linuxProxy.httpProxy || linuxProxy.httpsProxy) {
    const httpProxy = linuxProxy.httpProxy ?? linuxProxy.httpsProxy!;
    const httpsProxy = linuxProxy.httpsProxy ?? linuxProxy.httpProxy!;
    return {
      source: "linux-gsettings",
      env: buildProxyEnv(httpProxy, httpsProxy, noProxy),
    };
  }

  return { source: "none", env: {} };
}

export function resolveProxyEnv(): ResolvedProxyEnv {
  return resolveProxyEnvWithContext({
    platform: process.platform,
    env: process.env,
    runCommand: createDefaultCommandRunner(),
  });
}
