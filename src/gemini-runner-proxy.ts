import { execSync } from "node:child_process";

export type ProxySource = "env" | "windows-registry" | "none";

export interface ResolvedProxyEnv {
  env: Record<string, string>;
  source: ProxySource;
}

function pickEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeProxyUrl(value: string): string {
  return /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
}

function parseWindowsProxyServer(raw: string): { httpProxy?: string; httpsProxy?: string } {
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
      })
  );

  const httpProxy = entries.http ?? entries.https;
  const httpsProxy = entries.https ?? entries.http;
  return { httpProxy, httpsProxy };
}

function resolveWindowsRegistryProxy(): { httpProxy?: string; httpsProxy?: string } {
  if (process.platform !== "win32") {
    return {};
  }

  try {
    const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const enabled = execSync(`reg query "${key}" /v ProxyEnable`, {
      encoding: "utf8",
      timeout: 5000,
    });

    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) {
      return {};
    }

    const server = execSync(`reg query "${key}" /v ProxyServer`, {
      encoding: "utf8",
      timeout: 5000,
    });

    const match = server.match(/ProxyServer\s+REG_\w+\s+([^\r\n]+)/i);
    return match ? parseWindowsProxyServer(match[1]) : {};
  } catch {
    return {};
  }
}

export function resolveProxyEnv(): ResolvedProxyEnv {
  const envHttpProxy = pickEnv("HTTP_PROXY", "http_proxy");
  const envHttpsProxy = pickEnv("HTTPS_PROXY", "https_proxy");

  if (envHttpProxy || envHttpsProxy) {
    const httpProxy = envHttpProxy ?? envHttpsProxy!;
    const httpsProxy = envHttpsProxy ?? envHttpProxy!;
    return {
      source: "env",
      env: {
        HTTP_PROXY: httpProxy,
        http_proxy: httpProxy,
        HTTPS_PROXY: httpsProxy,
        https_proxy: httpsProxy,
      },
    };
  }

  const windowsProxy = resolveWindowsRegistryProxy();
  if (windowsProxy.httpProxy || windowsProxy.httpsProxy) {
    const httpProxy = windowsProxy.httpProxy ?? windowsProxy.httpsProxy!;
    const httpsProxy = windowsProxy.httpsProxy ?? windowsProxy.httpProxy!;
    return {
      source: "windows-registry",
      env: {
        HTTP_PROXY: httpProxy,
        http_proxy: httpProxy,
        HTTPS_PROXY: httpsProxy,
        https_proxy: httpsProxy,
      },
    };
  }

  return { source: "none", env: {} };
}
