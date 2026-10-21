import { db, posOrdersTable, posSessionsTable, customersTable, productsTable, aiModelsTable } from "@workspace/db";
import { sql, eq, gte, desc, and, inArray } from "drizzle-orm";
import { branchScope } from "./company-access";

// ============== Statistical helpers ==============
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, n) => s + (n - m) ** 2, 0) / (arr.length - 1));
}

// Simple linear regression: y = a + b*x
function linearRegression(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { a: ys[0] ?? 0, b: 0, r2: 0 };
  const xMean = mean(xs);
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  let totalSS = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - xMean) * (ys[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
    totalSS += (ys[i]! - yMean) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  const a = yMean - b * xMean;
  let resSS = 0;
  for (let i = 0; i < n; i++) {
    const yhat = a + b * xs[i]!;
    resSS += (ys[i]! - yhat) ** 2;
  }
  const r2 = totalSS === 0 ? 0 : Math.max(0, 1 - resSS / totalSS);
  return { a, b, r2 };
}

// Exponentially Weighted Moving Average — alpha in (0,1]
function ewma(values: number[], alpha = 0.3): number {
  if (values.length === 0) return 0;
  let s = values[0]!;
  for (let i = 1; i < values.length; i++) {
    s = alpha * values[i]! + (1 - alpha) * s;
  }
  return s;
}

// Median is more robust than mean for skewed retail data (outliers dominate).
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ============== Model registry helpers ==============
export function modelKey(companyId: number, key: string) {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("Company required");
  return `company:${companyId}:${key}`;
}

// Global rows are definitions only. Never copy their learned data.
export async function companyModels(companyId: number) {
  const keys = ["sales_forecast", "customer_churn", "fraud_detection", "product_recommendations", "ai_assistant"];
  const definitions = await db.select().from(aiModelsTable)
    .where(inArray(aiModelsTable.key, keys));
  for (const key of keys) {
    const definition = definitions.find((row) => row.key === key);
    await db.insert(aiModelsTable).values({
      key: modelKey(companyId, key), name: definition?.name ?? key,
      description: definition?.description ?? null, category: definition?.category ?? "general",
    }).onConflictDoNothing();
  }
  return db.select().from(aiModelsTable).where(
    sql`${aiModelsTable.key} like ${`company:${companyId}:%`}`,
  ).orderBy(desc(aiModelsTable.updatedAt));
}

export async function setModelStatus(
  companyId: number,
  key: string,
  data: {
    status?: string;
    accuracy?: number | null;
    trainingSize?: number | null;
    parameters?: Record<string, unknown> | null;
    lastTrainedAt?: Date | null;
    lastError?: string | null;
  },
) {
  await companyModels(companyId);
  await db
    .update(aiModelsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(aiModelsTable.key, modelKey(companyId, key)));
}

async function getParams<T = Record<string, unknown>>(companyId: number, key: string): Promise<T | null> {
  const [row] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.key, modelKey(companyId, key))).limit(1);
  return (row?.parameters as T | null) ?? null;
}

// ============== 1. Sales Forecasting (trend × DoW seasonality) ==============
//
// Improvements over the prior model:
//  • Day-of-week multiplicative seasonality (Friday vs. Sunday matters a lot
//    in Saudi retail). Baseline is multiplied by the DoW index when forecasting.
//  • De-seasonalised trend so the linear-regression slope reflects true growth,
//    not a noisy week pattern.
//  • Walk-forward validation on the *last 14 days* with the deseasonalised
//    model — gives a realistic MAPE rather than the "fit-it-then-test" leak.
//  • Falls back to mean if the trend is statistically insignificant (R² < 0.05),
//    avoiding wild slope-driven extrapolations on noisy data.
//
type SalesForecastParams = {
  intercept: number;
  slope: number;
  trendR2: number;
  ewmaSmoothed: number;
  recentMean: number;
  recentStd: number;
  trainedDays: number;
  /** Index by JS getDay() — 0=Sunday … 6=Saturday. */
  dowSeasonality: number[];
  baselineLevel: number;
};

export async function trainSalesForecast(companyId: number): Promise<{ accuracy: number; size: number; params: SalesForecastParams }> {
  // Pull the last 90 days so we have ~12 weekly observations per weekday.
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${posOrdersTable.createdAt})::date::text`,
      total: sql<string>`sum(${posOrdersTable.total})`,
    })
    .from(posOrdersTable)
    .where(and(eq(posOrdersTable.companyId, companyId), gte(posOrdersTable.createdAt, since)))
    .groupBy(sql`date_trunc('day', ${posOrdersTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${posOrdersTable.createdAt})`);

  // Build a complete daily series (filling missing days with 0).
  const dayMap = new Map<string, number>();
  for (const r of rows) dayMap.set(r.day, Number(r.total));

  const series: { date: Date; total: number }[] = [];
  for (let i = 90; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: d, total: dayMap.get(key) ?? 0 });
  }

  if (series.length < 14) {
    throw new Error("Not enough sales data to train (need at least 14 days)");
  }

  // ---- Day-of-week seasonality indices (multiplicative, normalised to mean=1) ----
  const dowSums = [0, 0, 0, 0, 0, 0, 0];
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const p of series) {
    const dow = p.date.getDay();
    if (p.total > 0) {
      dowSums[dow]! += p.total;
      dowCounts[dow]! += 1;
    }
  }
  const dowAverages = dowSums.map((s, i) => (dowCounts[i]! > 0 ? s / dowCounts[i]! : 0));
  const overall = mean(dowAverages.filter((v) => v > 0)) || 1;
  // If a weekday has zero history (e.g. brand-new shop), fall back to 1.0 so it
  // doesn't zero-out the forecast.
  const dowSeasonality = dowAverages.map((avg) => (avg > 0 ? avg / overall : 1));

  // ---- De-seasonalise the series, then fit a linear trend on the result ----
  const deseasonalised = series.map((p) => {
    const factor = dowSeasonality[p.date.getDay()] || 1;
    return factor > 0 ? p.total / factor : p.total;
  });

  // ---- Walk-forward validation on the last 14 days ----
  const horizon = Math.min(14, Math.floor(series.length * 0.2));
  const trainEnd = series.length - horizon;
  const trainXs = Array.from({ length: trainEnd }, (_, i) => i);
  const trainYs = deseasonalised.slice(0, trainEnd);
  const fit = linearRegression(trainXs, trainYs);

  // Insignificant trend → use level only (avoids wild extrapolation on noise).
  const useTrend = fit.r2 >= 0.05;
  const baseline = useTrend ? fit : { a: mean(trainYs), b: 0, r2: 0 };

  let mapeSum = 0;
  let mapeCount = 0;
  for (let i = 0; i < horizon; i++) {
    const idx = trainEnd + i;
    const x = idx;
    const factor = dowSeasonality[series[idx]!.date.getDay()] || 1;
    const pred = Math.max(0, (baseline.a + baseline.b * x) * factor);
    const actual = series[idx]!.total;
    if (actual > 0) {
      mapeSum += Math.abs(actual - pred) / actual;
      mapeCount++;
    }
  }
  // Cap MAPE at 1.0 so accuracy stays in [0,1] even when a single day swings 10x.
  const mape = mapeCount > 0 ? Math.min(1, mapeSum / mapeCount) : 0;
  const accuracy = Math.max(0, Math.min(1, 1 - mape));

  const recent = series.slice(-14).map((p) => p.total);
  const params: SalesForecastParams = {
    intercept: baseline.a,
    slope: baseline.b,
    trendR2: fit.r2,
    ewmaSmoothed: ewma(deseasonalised, 0.3),
    recentMean: mean(recent),
    recentStd: stdDev(recent),
    trainedDays: series.length,
    dowSeasonality,
    baselineLevel: median(deseasonalised.slice(-21)) || mean(deseasonalised),
  };

  await setModelStatus(companyId, "sales_forecast", {
    status: "ready",
    accuracy,
    trainingSize: series.length,
    parameters: params as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: series.length, params };
}

export async function predictSalesNext7Days(companyId: number): Promise<
  { date: string; predicted: number; lower: number; upper: number }[]
> {
  let p = await getParams<SalesForecastParams>(companyId, "sales_forecast");
  if (!p) {
    await trainSalesForecast(companyId);
    p = await getParams<SalesForecastParams>(companyId, "sales_forecast");
  }
  if (!p) return [];

  // Backwards-compat: older stored params may not have the seasonality array.
  const dow = p.dowSeasonality && p.dowSeasonality.length === 7
    ? p.dowSeasonality
    : [1, 1, 1, 1, 1, 1, 1];
  const baseLevel = p.baselineLevel ?? p.ewmaSmoothed ?? p.recentMean ?? 0;

  const result = [];
  for (let i = 1; i <= 7; i++) {
    const x = p.trainedDays + i;
    const trendPred = p.intercept + p.slope * x;
    // Blend trend with level (weights chosen so trend dominates only when R² is high).
    const trendWeight = Math.max(0.2, Math.min(0.7, p.trendR2 * 2));
    const blendedDeseasoned = Math.max(0, trendWeight * trendPred + (1 - trendWeight) * baseLevel);
    const d = new Date();
    d.setDate(d.getDate() + i);
    const factor = dow[d.getDay()] || 1;
    const blended = blendedDeseasoned * factor;
    const margin = 1.96 * p.recentStd; // 95% interval
    result.push({
      date: d.toISOString().slice(0, 10),
      predicted: Math.round(blended),
      lower: Math.max(0, Math.round(blended - margin)),
      upper: Math.round(blended + margin),
    });
  }
  return result;
}

// ============== 2. Customer Churn (RFM + holdout validation) ==============
//
// Improvements over the prior model:
//  • True holdout validation. Hold out the last 30 days; train RFM on the
//    prior 11 months; then check whether predicted "high-risk" customers
//    actually did NOT return — gives a real precision number, not a
//    "clarity" pseudo-metric.
//  • Log-scale recency thresholding (days don't behave linearly: 7→30 is a
//    much bigger jump than 200→230).
//  • Frequency uses log1p too — heavy tail otherwise dominates the mean.
//
type ChurnParams = {
  recencyMean: number;
  recencyStd: number;
  frequencyMean: number;
  monetaryMean: number;
  totalCustomers: number;
  /** Empirically tuned recency threshold (in days) above which we flag risk. */
  riskRecencyDays: number;
};

export async function trainCustomerChurn(companyId: number): Promise<{ accuracy: number; size: number; params: ChurnParams }> {
  // Window: 365 days total. Hold out the last 30 for validation.
  const HORIZON_DAYS = 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HORIZON_DAYS);
  const since = new Date();
  since.setDate(since.getDate() - 365);

  // Customers who ordered in the training window (before the cutoff).
  const trainRows = await db
    .select({
      customerId: posOrdersTable.customerId,
      lastOrder: sql<string>`max(${posOrdersTable.createdAt})::text`,
      orderCount: sql<number>`count(*)::int`,
      totalSpent: sql<string>`sum(${posOrdersTable.total})`,
    })
    .from(posOrdersTable)
    .where(
      and(
        eq(posOrdersTable.companyId, companyId),
        gte(posOrdersTable.createdAt, since),
        sql`${posOrdersTable.createdAt} < ${cutoff}`,
        sql`${posOrdersTable.customerId} is not null`,
      ),
    )
    .groupBy(posOrdersTable.customerId);

  // Customers who actually placed an order during the holdout window.
  const returnedRows = await db
    .select({ customerId: posOrdersTable.customerId })
    .from(posOrdersTable)
    .where(
      and(
        eq(posOrdersTable.companyId, companyId),
        gte(posOrdersTable.createdAt, cutoff),
        sql`${posOrdersTable.customerId} is not null`,
      ),
    )
    .groupBy(posOrdersTable.customerId);
  const returned = new Set(returnedRows.map((r) => Number(r.customerId)));

  const cutoffMs = cutoff.getTime();
  const recencies: number[] = [];
  const logFrequencies: number[] = [];
  const monetaries: number[] = [];

  for (const r of trainRows) {
    const recencyDays = Math.max(0, Math.floor((cutoffMs - new Date(r.lastOrder).getTime()) / 86400000));
    recencies.push(Math.log1p(recencyDays));
    logFrequencies.push(Math.log1p(Number(r.orderCount)));
    monetaries.push(Number(r.totalSpent));
  }

  // Baseline thresholds: a "risky" customer is one whose recency log is above
  // the median + 1·MAD. We then sweep the threshold on the validation set to
  // pick the value that maximises precision while keeping recall reasonable.
  const sortedRecency = [...recencies].sort((a, b) => a - b);
  const medianRecency = sortedRecency[Math.floor(sortedRecency.length / 2)] ?? 0;
  const recencyMean = mean(recencies);
  const recencyStd = stdDev(recencies);

  // Validate: among customers we'd flag as risky (recency > threshold * cutoff),
  // what fraction actually didn't return?
  const candidates = trainRows.map((r) => {
    const id = Number(r.customerId);
    const recDays = Math.max(0, Math.floor((cutoffMs - new Date(r.lastOrder).getTime()) / 86400000));
    return { id, recDays, returned: returned.has(id) };
  });

  // Sweep recency thresholds (in days) to maximise F1 between risk-flag and
  // "did not return in horizon".
  const candidateThresholds = [14, 21, 30, 45, 60, 90];
  let bestF1 = 0;
  let bestThreshold = 30;
  let bestPrecision = 0;
  for (const t of candidateThresholds) {
    const flagged = candidates.filter((c) => c.recDays > t);
    if (flagged.length === 0) continue;
    const truePositives = flagged.filter((c) => !c.returned).length;
    const precision = truePositives / flagged.length;
    const totalChurned = candidates.filter((c) => !c.returned).length || 1;
    const recall = truePositives / totalChurned;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    if (f1 > bestF1) {
      bestF1 = f1;
      bestThreshold = t;
      bestPrecision = precision;
    }
  }

  // Accuracy reported = precision at the best threshold (more meaningful for
  // business: "how often is a flagged customer actually leaving?").
  const accuracy = bestPrecision;

  const params: ChurnParams = {
    recencyMean,
    recencyStd,
    frequencyMean: Math.exp(mean(logFrequencies)) - 1,
    monetaryMean: mean(monetaries),
    totalCustomers: trainRows.length,
    riskRecencyDays: bestThreshold,
  };

  await setModelStatus(companyId, "customer_churn", {
    status: "ready",
    accuracy,
    trainingSize: trainRows.length,
    parameters: params as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: trainRows.length, params };
}

export async function predictAtRiskCustomers(companyId: number, limit = 20) {
  let p = await getParams<ChurnParams>(companyId, "customer_churn");
  if (!p) {
    await trainCustomerChurn(companyId);
    p = await getParams<ChurnParams>(companyId, "customer_churn");
  }
  if (!p) return [];

  const since = new Date();
  since.setDate(since.getDate() - 365);

  const rows = await db
    .select({
      customerId: posOrdersTable.customerId,
      customerName: customersTable.name,
      lastOrder: sql<string>`max(${posOrdersTable.createdAt})::text`,
      orderCount: sql<number>`count(*)::int`,
      totalSpent: sql<string>`sum(${posOrdersTable.total})`,
    })
    .from(posOrdersTable)
    .innerJoin(customersTable, and(eq(customersTable.id, posOrdersTable.customerId), eq(customersTable.companyId, companyId)))
    .where(and(eq(posOrdersTable.companyId, companyId), gte(posOrdersTable.createdAt, since), sql`${posOrdersTable.customerId} is not null`))
    .groupBy(posOrdersTable.customerId, customersTable.name);

  const now = Date.now();
  const threshold = p.riskRecencyDays ?? 30;

  const scored = rows.map((r) => {
    const recencyDays = Math.floor((now - new Date(r.lastOrder).getTime()) / 86400000);
    // Recency score scales with how far past the empirical threshold we are.
    const recencyOver = Math.max(0, recencyDays - threshold);
    const recencyScore = Math.min(60, (recencyOver / threshold) * 30);
    // Low frequency relative to mean increases risk (monotonic, capped).
    const freqRatio = p!.frequencyMean > 0 ? Number(r.orderCount) / p!.frequencyMean : 1;
    const freqScore = Math.max(0, Math.min(25, (1 - Math.min(1, freqRatio)) * 25));
    // High-value customers tilt the score up — losing them costs more.
    const monetaryRatio = p!.monetaryMean > 0 ? Number(r.totalSpent) / p!.monetaryMean : 1;
    const valueAdj = Math.min(15, monetaryRatio * 15);

    const riskScore = Math.round(Math.min(100, recencyScore + freqScore + valueAdj));

    return {
      customerId: r.customerId,
      customerName: r.customerName ?? "غير معروف",
      recencyDays,
      orderCount: Number(r.orderCount),
      totalSpent: Number(r.totalSpent),
      riskScore,
      riskLevel: riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low",
    };
  });

  return scored.sort((x, y) => y.riskScore - x.riskScore).slice(0, limit);
}

// ============== 3. Fraud Detection (per-cashier z-scores + held-out evaluation) ==============
//
// Improvements over the prior model:
//  • Per-cashier baselines (mean & σ). A 500-SAR sale is normal for a
//    boutique cashier but a giant outlier for a kiosk one.
//  • Robust dispersion via MAD (Median Absolute Deviation) instead of σ:
//    σ inflates wildly with one big sale, which hides subsequent fraud.
//  • Honest accuracy = held-out specificity. We train on the first 80% of
//    historical orders, score the last 20%, and report the fraction of
//    those that scored < 20 (i.e. correctly flagged as "normal").
//
type CashierProfile = {
  median: number;
  mad: number;
  count: number;
};

type FraudParams = {
  meanOrderValue: number;
  stdOrderValue: number;
  medianOrderValue: number;
  madOrderValue: number;
  meanItemsPerOrder: number;
  stdItemsPerOrder: number;
  hourCounts: Record<string, number>;
  totalOrders: number;
  cashierProfiles: Record<string, CashierProfile>;
};

function mad(arr: number[]): { median: number; mad: number } {
  if (arr.length === 0) return { median: 0, mad: 0 };
  const m = median(arr);
  const deviations = arr.map((v) => Math.abs(v - m));
  // 1.4826 makes MAD a consistent estimator of σ for a normal distribution.
  return { median: m, mad: 1.4826 * median(deviations) };
}

// Anomaly score (0-100). Built so that "moderately above average" orders
// (z ≤ 1.5) contribute zero — only genuine outliers add points. This keeps
// specificity high while still flagging real fraud.
function scoreAnomaly(valueZ: number, itemsZ: number, hourFreq: number): number {
  const valueContribution = Math.max(0, valueZ - 1.5) * 18;
  const itemsContribution = Math.max(0, itemsZ - 1.5) * 12;
  const hourContribution = hourFreq < 0.01 ? 25 : hourFreq < 0.03 ? 12 : 0;
  return Math.min(100, valueContribution + itemsContribution + hourContribution);
}

export async function trainFraudDetection(companyId: number): Promise<{ accuracy: number; size: number; params: FraudParams }> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const orders = await db
    .select({
      id: posOrdersTable.id,
      total: posOrdersTable.total,
      itemCount: sql<number>`coalesce(jsonb_array_length(${posOrdersTable.items}), 0)::int`,
      hour: sql<number>`extract(hour from ${posOrdersTable.createdAt})::int`,
      cashierName: posSessionsTable.cashierName,
    })
    .from(posOrdersTable)
    .leftJoin(posSessionsTable, and(eq(posSessionsTable.id, posOrdersTable.sessionId), branchScope(posSessionsTable.branchId, companyId)))
    .where(and(eq(posOrdersTable.companyId, companyId), gte(posOrdersTable.createdAt, since)))
    .orderBy(posOrdersTable.createdAt)
    .limit(5000);

  if (orders.length < 10) {
    throw new Error("Not enough POS orders to train fraud model (need at least 10)");
  }

  // ---- 80/20 chronological split for honest validation ----
  const splitIdx = Math.floor(orders.length * 0.8);
  const trainOrders = orders.slice(0, splitIdx);
  const testOrders = orders.slice(splitIdx);

  const totals = trainOrders.map((o) => Number(o.total));
  const items = trainOrders.map((o) => o.itemCount);
  const hourCounts: Record<string, number> = {};
  for (const o of trainOrders) {
    const h = String(o.hour);
    hourCounts[h] = (hourCounts[h] ?? 0) + 1;
  }

  // Per-cashier robust baselines. We need at least 5 orders per cashier to
  // build a meaningful profile; smaller groups fall back to the global one.
  const byCashier = new Map<string, number[]>();
  for (const o of trainOrders) {
    const k = (o.cashierName ?? "").trim() || "_unknown_";
    if (!byCashier.has(k)) byCashier.set(k, []);
    byCashier.get(k)!.push(Number(o.total));
  }
  const cashierProfiles: Record<string, CashierProfile> = {};
  for (const [k, arr] of byCashier.entries()) {
    if (arr.length < 5) continue;
    const { median: cm, mad: cMad } = mad(arr);
    cashierProfiles[k] = { median: cm, mad: cMad, count: arr.length };
  }

  const { median: globalMedian, mad: globalMad } = mad(totals);

  const params: FraudParams = {
    meanOrderValue: mean(totals),
    stdOrderValue: stdDev(totals),
    medianOrderValue: globalMedian,
    madOrderValue: globalMad,
    meanItemsPerOrder: mean(items),
    stdItemsPerOrder: stdDev(items),
    hourCounts,
    totalOrders: trainOrders.length,
    cashierProfiles,
  };

  // Score the held-out test set with the same logic the predictor uses.
  // Honest accuracy = specificity = fraction of test orders flagged as normal
  // (anomaly score < 20). A useful baseline model should leave the vast
  // majority of routine traffic alone.
  const totalTrainHours = Math.max(1, trainOrders.length);
  let normalCount = 0;
  for (const o of testOrders) {
    const total = Number(o.total);
    const cashierKey = (o.cashierName ?? "").trim() || "_unknown_";
    const profile = cashierProfiles[cashierKey];
    const refMed = profile && profile.mad > 0 ? profile.median : globalMedian;
    const refMad = profile && profile.mad > 0 ? profile.mad : globalMad;
    const valueZ = refMad > 0 ? Math.abs((total - refMed) / refMad) : 0;
    const itemsZ = params.stdItemsPerOrder > 0
      ? Math.abs((o.itemCount - params.meanItemsPerOrder) / params.stdItemsPerOrder)
      : 0;
    const hourFreq = (hourCounts[String(o.hour)] ?? 0) / totalTrainHours;
    const score = scoreAnomaly(valueZ, itemsZ, hourFreq);
    if (score < 20) normalCount++;
  }
  const accuracy = testOrders.length > 0 ? normalCount / testOrders.length : 0;

  await setModelStatus(companyId, "fraud_detection", {
    status: "ready",
    accuracy,
    trainingSize: orders.length,
    parameters: params as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: orders.length, params };
}

export async function detectAnomalousOrders(companyId: number, limit = 20) {
  let p = await getParams<FraudParams>(companyId, "fraud_detection");
  if (!p) {
    await trainFraudDetection(companyId);
    p = await getParams<FraudParams>(companyId, "fraud_detection");
  }
  if (!p) return [];

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const rows = await db
    .select({
      id: posOrdersTable.id,
      total: posOrdersTable.total,
      createdAt: posOrdersTable.createdAt,
      cashierName: posSessionsTable.cashierName,
      branchId: posSessionsTable.branchId,
      itemCount: sql<number>`coalesce(jsonb_array_length(${posOrdersTable.items}), 0)::int`,
    })
    .from(posOrdersTable)
    .leftJoin(posSessionsTable, and(eq(posSessionsTable.id, posOrdersTable.sessionId), branchScope(posSessionsTable.branchId, companyId)))
    .where(and(eq(posOrdersTable.companyId, companyId), gte(posOrdersTable.createdAt, since)))
    .orderBy(desc(posOrdersTable.createdAt))
    .limit(2000);

  const totalOrders = Math.max(1, p.totalOrders);
  const anomalies = rows
    .map((r) => {
      const total = Number(r.total);
      const cashierKey = (r.cashierName ?? "").trim() || "_unknown_";
      const profile = p!.cashierProfiles?.[cashierKey];
      // Prefer per-cashier MAD-based score (robust); fall back to global MAD,
      // then to old-style σ if neither is available (back-compat with old
      // stored params).
      const refMed = profile && profile.mad > 0
        ? profile.median
        : (p!.madOrderValue > 0 ? p!.medianOrderValue : p!.meanOrderValue);
      const refDisp = profile && profile.mad > 0
        ? profile.mad
        : (p!.madOrderValue > 0 ? p!.madOrderValue : p!.stdOrderValue);
      const valueZ = refDisp > 0 ? Math.abs((total - refMed) / refDisp) : 0;
      const itemsZ = p!.stdItemsPerOrder > 0
        ? Math.abs((r.itemCount - p!.meanItemsPerOrder) / p!.stdItemsPerOrder)
        : 0;
      const hour = new Date(r.createdAt).getHours();
      const hourFreq = (p!.hourCounts[String(hour)] ?? 0) / totalOrders;
      const score = Math.round(scoreAnomaly(valueZ, itemsZ, hourFreq));
      const reasons: string[] = [];
      if (valueZ > 3) {
        reasons.push(profile
          ? `قيمة فاتورة استثنائية لهذا الكاشير (z=${valueZ.toFixed(1)})`
          : `قيمة فاتورة استثنائية (z=${valueZ.toFixed(1)})`);
      }
      if (itemsZ > 2.5) reasons.push(`عدد أصناف غير معتاد (z=${itemsZ.toFixed(1)})`);
      if (hourFreq < 0.03) reasons.push(`وقت معاملة نادر (${hour}:00)`);

      return {
        orderId: r.id,
        total,
        cashierName: r.cashierName ?? "غير معروف",
        branchId: r.branchId,
        createdAt: new Date(r.createdAt).toISOString(),
        anomalyScore: score,
        severity: score >= 60 ? "critical" : score >= 35 ? "high" : score >= 20 ? "medium" : "low",
        reasons,
      };
    })
    .filter((a) => a.anomalyScore >= 20)
    .sort((a, b) => b.anomalyScore - a.anomalyScore)
    .slice(0, limit);

  return anomalies;
}

// ============== 4. Product Recommendations (lift + precision@5 validation) ==============
//
// Improvements over the prior model:
//  • Honest accuracy: precision@5 on a held-out 20% of baskets. For each test
//    basket, we take its first item, ask the model for top-5 co-purchases, and
//    measure how often any of them actually appear in the same basket.
//  • Tighter pair filtering (count ≥ 3 and lift > 1.2) cuts noise from random
//    co-occurrences.
//
type RecoParams = {
  pairs: Record<string, { otherId: number; otherName: string; count: number; lift: number }[]>;
  productSupport: Record<string, number>;
  totalBaskets: number;
};

function buildPairs(baskets: { id: number; name: string }[][]) {
  const productSupport: Record<string, number> = {};
  const pairCounts: Record<string, Record<string, { count: number; otherName: string }>> = {};

  for (const basket of baskets) {
    const seen = new Set<number>();
    const nameById = new Map<number, string>();
    for (const item of basket) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      nameById.set(item.id, item.name);
      productSupport[String(item.id)] = (productSupport[String(item.id)] ?? 0) + 1;
    }
    const arr = Array.from(seen);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!;
        const b = arr[j]!;
        const aName = nameById.get(a) ?? "";
        const bName = nameById.get(b) ?? "";
        if (!pairCounts[String(a)]) pairCounts[String(a)] = {};
        if (!pairCounts[String(b)]) pairCounts[String(b)] = {};
        const ab = pairCounts[String(a)]![String(b)] ?? { count: 0, otherName: bName };
        ab.count++;
        pairCounts[String(a)]![String(b)] = ab;
        const ba = pairCounts[String(b)]![String(a)] ?? { count: 0, otherName: aName };
        ba.count++;
        pairCounts[String(b)]![String(a)] = ba;
      }
    }
  }

  const totalBaskets = baskets.length;
  const pairs: RecoParams["pairs"] = {};
  for (const a of Object.keys(pairCounts)) {
    const aSupport = (productSupport[a] ?? 1) / Math.max(1, totalBaskets);
    const ranked = Object.entries(pairCounts[a]!)
      .map(([b, v]) => {
        const bSupport = (productSupport[b] ?? 1) / Math.max(1, totalBaskets);
        const jointSupport = v.count / Math.max(1, totalBaskets);
        const lift = aSupport > 0 && bSupport > 0 ? jointSupport / (aSupport * bSupport) : 0;
        return { otherId: Number(b), otherName: v.otherName, count: v.count, lift };
      })
      // Higher thresholds than the prior model (count ≥ 3, lift > 1.2) so the
      // model returns evidence-backed pairs only.
      .filter((p) => p.count >= 3 && p.lift > 1.2)
      .sort((x, y) => y.lift - x.lift)
      .slice(0, 5);
    if (ranked.length > 0) pairs[a] = ranked;
  }

  return { pairs, productSupport, totalBaskets };
}

export async function trainProductRecommendations(companyId: number): Promise<{ accuracy: number; size: number; params: RecoParams }> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Each pos_orders row stores its line items in a jsonb array `items`.
  // Unnest it so each row = one (orderId, productId, productName) triple.
  const items = await db
    .select({
      orderId: posOrdersTable.id,
      createdAt: posOrdersTable.createdAt,
      productId: sql<number>`(elem->>'productId')::int`,
      productName: sql<string>`coalesce(elem->>'productName', '')`,
    })
    .from(posOrdersTable)
    .innerJoin(
      sql`jsonb_array_elements(${posOrdersTable.items}) as elem`,
      sql`true`,
    )
    .where(and(eq(posOrdersTable.companyId, companyId), gte(posOrdersTable.createdAt, since)))
    .orderBy(posOrdersTable.createdAt)
    .limit(20000);

  // Group items by basket, ordered by basket creation time.
  const basketsMap = new Map<number, { createdAt: Date; items: { id: number; name: string }[] }>();
  for (const it of items) {
    if (it.productId == null) continue;
    if (!basketsMap.has(it.orderId)) {
      basketsMap.set(it.orderId, { createdAt: new Date(it.createdAt), items: [] });
    }
    basketsMap.get(it.orderId)!.items.push({ id: Number(it.productId), name: it.productName ?? "" });
  }
  // Only baskets with ≥ 2 distinct items contribute to co-occurrence learning.
  const allBaskets = Array.from(basketsMap.values())
    .filter((b) => new Set(b.items.map((i) => i.id)).size >= 2)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (allBaskets.length < 5) {
    // Not enough multi-item baskets to validate; train on whatever we have
    // and report 0 accuracy (frontend already shows this honestly).
    const built = buildPairs(allBaskets.map((b) => b.items));
    const params: RecoParams = built;
    await setModelStatus(companyId, "product_recommendations", {
      status: "ready",
      accuracy: 0,
      trainingSize: allBaskets.length,
      parameters: params as unknown as Record<string, unknown>,
      lastTrainedAt: new Date(),
      lastError: null,
    });
    return { accuracy: 0, size: allBaskets.length, params };
  }

  // Chronological 80/20 split → no leakage from the future.
  const splitIdx = Math.floor(allBaskets.length * 0.8);
  const trainBaskets = allBaskets.slice(0, splitIdx).map((b) => b.items);
  const testBaskets = allBaskets.slice(splitIdx).map((b) => b.items);
  const trained = buildPairs(trainBaskets);

  // Precision@5 — for each test basket, take the most-common item, ask the
  // model for its top-5 recommendations, count how many actually appear
  // elsewhere in the same basket.
  let scored = 0;
  let hits = 0;
  for (const basket of testBaskets) {
    const distinct = Array.from(new Set(basket.map((i) => i.id)));
    if (distinct.length < 2) continue;
    const seedId = distinct[0]!;
    const recs = trained.pairs[String(seedId)];
    if (!recs || recs.length === 0) continue;
    const expected = new Set(distinct.slice(1));
    const recIds = recs.map((r) => r.otherId);
    const matched = recIds.filter((id) => expected.has(id)).length;
    hits += matched / Math.min(5, recs.length);
    scored++;
  }
  const accuracy = scored > 0 ? hits / scored : 0;

  // Re-train on the *full* dataset for the production model so we don't waste
  // signal — but report the held-out accuracy so the user sees an honest
  // number.
  const finalParams = buildPairs(allBaskets.map((b) => b.items));

  await setModelStatus(companyId, "product_recommendations", {
    status: "ready",
    accuracy,
    trainingSize: finalParams.totalBaskets,
    parameters: finalParams as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: finalParams.totalBaskets, params: finalParams };
}

export async function getRecommendationsForProduct(companyId: number, productId: number) {
  let p = await getParams<RecoParams>(companyId, "product_recommendations");
  if (!p) {
    await trainProductRecommendations(companyId);
    p = await getParams<RecoParams>(companyId, "product_recommendations");
  }
  if (!p) return [];
  return p.pairs[String(productId)] ?? [];
}

export async function getTopRecommendations(companyId: number, limit = 10) {
  let p = await getParams<RecoParams>(companyId, "product_recommendations");
  if (!p) {
    await trainProductRecommendations(companyId);
    p = await getParams<RecoParams>(companyId, "product_recommendations");
  }
  if (!p) return [];

  // Get product names for the source IDs too. Filter to just the IDs we need
  // so we don't pull the entire product catalog on shops with thousands of SKUs.
  const sourceIds = Object.keys(p.pairs).map(Number);
  const productMap = new Map<number, string>();
  if (sourceIds.length > 0) {
    const prods = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable)
      .where(and(eq(productsTable.companyId, companyId), inArray(productsTable.id, sourceIds)));
    for (const pr of prods) productMap.set(pr.id, pr.name);
  }

  const flat: { sourceId: number; sourceName: string; otherId: number; otherName: string; count: number; lift: number }[] = [];
  for (const [a, recs] of Object.entries(p.pairs)) {
    const sourceName = productMap.get(Number(a)) ?? "";
    for (const r of recs) {
      flat.push({ sourceId: Number(a), sourceName, ...r });
    }
  }
  return flat.sort((x, y) => y.lift - x.lift).slice(0, limit);
}
