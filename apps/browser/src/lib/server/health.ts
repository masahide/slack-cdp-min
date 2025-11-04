import type { HealthStatus } from "$lib/viewModels/dashboard";

interface HealthResponse {
  status?: string;
  message?: string;
  updatedAt?: string;
  timestamp?: string;
}

export async function fetchHealthStatus(
  fetchFn: typeof fetch,
  endpoint: string | null
): Promise<HealthStatus | null> {
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetchFn(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as HealthResponse;
    const status = normalizeStatus(payload.status);
    return {
      status,
      message: payload.message ?? messageFromStatus(status),
      updatedAt: payload.updatedAt ?? payload.timestamp ?? new Date().toISOString(),
    } satisfies HealthStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    return {
      status: "error",
      message: `取得失敗: ${message}`,
      updatedAt: new Date().toISOString(),
    } satisfies HealthStatus;
  }
}

function normalizeStatus(input?: string): HealthStatus["status"] {
  switch (input) {
    case "ok":
    case "healthy":
      return "ok";
    case "warning":
    case "degraded":
      return "warning";
    case "error":
    case "critical":
      return "error";
    default:
      return "warning";
  }
}

function messageFromStatus(status: HealthStatus["status"]): string {
  switch (status) {
    case "ok":
      return "稼働中";
    case "warning":
      return "警告";
    case "error":
      return "エラー";
  }
}
