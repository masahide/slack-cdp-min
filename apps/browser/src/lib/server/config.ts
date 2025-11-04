import { resolve as resolvePath } from "node:path";

export interface ServerConfig {
  dataDir: string;
  healthEndpoint: string | null;
}

let cachedConfig: ServerConfig | null = null;

export function loadServerConfig(): ServerConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const dataDirEnv = process.env.REACLOG_DATA_DIR;
  const dataDir = resolvePath(dataDirEnv && dataDirEnv.length > 0 ? dataDirEnv : "data");

  const healthEndpoint = process.env.REACLOG_HEALTH_ENDPOINT?.trim() ?? null;

  cachedConfig = {
    dataDir,
    healthEndpoint: healthEndpoint && healthEndpoint.length > 0 ? healthEndpoint : null,
  };

  return cachedConfig;
}

export function resolveDataDir(): string {
  return loadServerConfig().dataDir;
}

export function resolveHealthEndpoint(): string | null {
  return loadServerConfig().healthEndpoint;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
