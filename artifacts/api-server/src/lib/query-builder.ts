import { pool } from "@workspace/db";
import type { DataSource, DataSourceColumn } from "./data-sources";
import { getDataSource } from "./data-sources";

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "between" | "is_null" | "not_null";
export type AggregateFn = "sum" | "avg" | "count" | "min" | "max";

export interface ReportFilter {
  column: string;
  op: FilterOp;
  value?: unknown;
  value2?: unknown;
}

export interface ReportAggregate {
  column: string;
  fn: AggregateFn;
  alias?: string;
}

export interface ReportConfig {
  columns: string[];
  filters?: ReportFilter[];
  groupBy?: string[];
  aggregates?: ReportAggregate[];
  orderBy?: { column: string; dir?: "asc" | "desc" }[];
  limit?: number;
}

const HARD_ROW_CAP = 5000;

export interface BuiltReport {
  source: DataSource;
  outputColumns: { key: string; label: string; type: string }[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

function findColumn(source: DataSource, key: string): DataSourceColumn {
  const col = source.columns.find((c) => c.key === key);
  if (!col) throw new Error(`Unknown column "${key}" for source "${source.key}"`);
  return col;
}

function aggSqlFor(col: DataSourceColumn, fn: AggregateFn): string {
  switch (fn) {
    case "sum": return `coalesce(sum(${col.expr}), 0)`;
    case "avg": return `coalesce(avg(${col.expr}), 0)`;
    case "count": return `count(${col.expr})`;
    case "min": return `min(${col.expr})`;
    case "max": return `max(${col.expr})`;
  }
}

export async function runReport(sourceKey: string, config: ReportConfig): Promise<BuiltReport> {
  const source = getDataSource(sourceKey);
  if (!source) throw new Error(`Unknown data source "${sourceKey}"`);

  if (!Array.isArray(config.columns) || config.columns.length === 0) {
    throw new Error("يجب اختيار عمود واحد على الأقل");
  }

  const groupBy = (config.groupBy ?? []).map((k) => findColumn(source, k));
  const aggregates = (config.aggregates ?? []).map((a) => ({
    fn: a.fn,
    col: findColumn(source, a.column),
    alias: a.alias || `${a.fn}_${a.column}`,
  }));

  const isAggregated = aggregates.length > 0 || groupBy.length > 0;

  const selectParts: string[] = [];
  const outputColumns: { key: string; label: string; type: string }[] = [];

  if (isAggregated) {
    for (const g of groupBy) {
      selectParts.push(`${g.expr} as "${g.key}"`);
      outputColumns.push({ key: g.key, label: g.label, type: g.type });
    }
    for (const a of aggregates) {
      selectParts.push(`${aggSqlFor(a.col, a.fn)} as "${a.alias}"`);
      outputColumns.push({ key: a.alias, label: `${a.fn}(${a.col.label})`, type: "number" });
    }
  } else {
    for (const key of config.columns) {
      const col = findColumn(source, key);
      selectParts.push(`${col.expr} as "${col.key}"`);
      outputColumns.push({ key: col.key, label: col.label, type: col.type });
    }
  }

  const params: unknown[] = [];
  function ph(v: unknown): string {
    params.push(v);
    return `$${params.length}`;
  }

  const whereParts: string[] = [];
  for (const f of config.filters ?? []) {
    const col = findColumn(source, f.column);
    switch (f.op) {
      case "eq": whereParts.push(`${col.expr} = ${ph(f.value)}`); break;
      case "neq": whereParts.push(`${col.expr} <> ${ph(f.value)}`); break;
      case "gt": whereParts.push(`${col.expr} > ${ph(f.value)}`); break;
      case "gte": whereParts.push(`${col.expr} >= ${ph(f.value)}`); break;
      case "lt": whereParts.push(`${col.expr} < ${ph(f.value)}`); break;
      case "lte": whereParts.push(`${col.expr} <= ${ph(f.value)}`); break;
      case "contains": whereParts.push(`${col.expr}::text ilike ${ph(`%${String(f.value ?? "")}%`)}`); break;
      case "in": {
        const arr = Array.isArray(f.value) ? f.value : [];
        if (arr.length === 0) { whereParts.push("false"); break; }
        const slots = arr.map((v) => ph(v)).join(",");
        whereParts.push(`${col.expr} in (${slots})`);
        break;
      }
      case "between":
        whereParts.push(`${col.expr} between ${ph(f.value)} and ${ph(f.value2)}`);
        break;
      case "is_null": whereParts.push(`${col.expr} is null`); break;
      case "not_null": whereParts.push(`${col.expr} is not null`); break;
    }
  }

  const orderParts: string[] = [];
  for (const o of config.orderBy ?? []) {
    if (isAggregated) {
      const isGroup = groupBy.find((g) => g.key === o.column);
      const isAgg = aggregates.find((a) => a.alias === o.column || a.col.key === o.column);
      if (isGroup) orderParts.push(`"${isGroup.key}" ${o.dir === "desc" ? "desc" : "asc"}`);
      else if (isAgg) orderParts.push(`"${isAgg.alias}" ${o.dir === "desc" ? "desc" : "asc"}`);
    } else {
      const col = findColumn(source, o.column);
      orderParts.push(`${col.expr} ${o.dir === "desc" ? "desc" : "asc"}`);
    }
  }

  const limit = Math.min(Math.max(1, config.limit ?? 1000), HARD_ROW_CAP);

  let queryText = `select ${selectParts.join(", ")} from ${source.fromSql}`;
  if (whereParts.length) queryText += ` where ${whereParts.join(" and ")}`;
  if (isAggregated && groupBy.length) {
    queryText += ` group by ${groupBy.map((g) => g.expr).join(", ")}`;
  }
  if (orderParts.length) queryText += ` order by ${orderParts.join(", ")}`;
  queryText += ` limit ${limit}`;

  const result = await pool.query(queryText, params);
  const rows = (result.rows ?? []) as Array<Record<string, unknown>>;

  const cleaned = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of outputColumns) {
      const v = row[c.key];
      if (v == null) out[c.key] = null;
      else if (c.type === "number") out[c.key] = Number(v);
      else if (c.type === "datetime" || c.type === "date") {
        out[c.key] = v instanceof Date ? v.toISOString() : String(v);
      } else out[c.key] = v;
    }
    return out;
  });

  return { source, outputColumns, rows: cleaned, rowCount: cleaned.length };
}

export function rowsToCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return "\uFEFF" + lines.join("\n");
}
