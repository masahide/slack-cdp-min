export interface DashboardSourceCount {
  source: string;
  count: number;
}

export interface DashboardDay {
  date: string;
  total: number;
  sources: DashboardSourceCount[];
  hasSummary: boolean;
  summaryPreview: string | null;
}

export type HealthStatus = {
  status: "ok" | "warning" | "error";
  message: string;
  updatedAt?: string;
};

export interface DashboardLoadData {
  days: DashboardDay[];
  health: HealthStatus | null;
  generatedAt: string;
}
