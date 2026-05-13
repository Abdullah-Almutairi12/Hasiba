const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export async function reportsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function reportExportUrl(id: number, format: "csv" | "xlsx" | "pdf"): string {
  return `${API_BASE}/reports/definitions/${id}/export?format=${format}`;
}

export type DataSourceColumn = {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "datetime" | "boolean";
  aggregatable: boolean;
};

export type DataSource = {
  key: string;
  label: string;
  module: string;
  columns: DataSourceColumn[];
  defaultDateColumn?: string;
};

export type ReportFilter = {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "between" | "is_null" | "not_null";
  value?: unknown;
  value2?: unknown;
};

export type ReportAggregate = { column: string; fn: "sum" | "avg" | "count" | "min" | "max"; alias?: string };

export type ReportConfig = {
  columns: string[];
  filters?: ReportFilter[];
  groupBy?: string[];
  aggregates?: ReportAggregate[];
  orderBy?: { column: string; dir?: "asc" | "desc" }[];
  limit?: number;
};

export type ReportRunResult = {
  columns: { key: string; label: string; type: string }[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
};

export type ReportDefinition = {
  id: number;
  name: string;
  description: string | null;
  dataSource: string;
  config: ReportConfig;
  chartType: "table" | "bar" | "line" | "pie" | "kpi";
  ownerUserId: number;
  sharedWithRole: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type Dashboard = {
  id: number;
  name: string;
  ownerUserId: number;
  isHome: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DashboardWidget = {
  id: number;
  dashboardId: number;
  type: "kpi" | "chart" | "list" | "iframe" | "text";
  title: string;
  config: Record<string, unknown>;
  position: number;
  width: number;
  createdAt: string;
};

export type Subscription = {
  id: number;
  reportId: number;
  ownerUserId: number;
  recipients: string[];
  cadence: "daily" | "weekly" | "monthly";
  format: "csv" | "xlsx" | "pdf";
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
};

export type KpiAlert = {
  id: number;
  name: string;
  ownerUserId: number;
  reportId: number | null;
  metricColumn: string;
  operator: "above" | "below" | "changed_by";
  threshold: number;
  isActive: boolean;
  lastEvaluatedAt: string | null;
  lastValue: number | null;
  createdAt: string;
};
