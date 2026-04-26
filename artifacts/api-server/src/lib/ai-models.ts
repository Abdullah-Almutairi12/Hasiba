import { db, posOrdersTable, posSessionsTable, customersTable, productsTable, aiModelsTable } from "@workspace/db";
import { sql, eq, gte, desc, and } from "drizzle-orm";

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

// ============== Model registry helpers ==============
async function setModelStatus(
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
  await db
    .update(aiModelsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(aiModelsTable.key, key));
}

async function getParams<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const [row] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.key, key)).limit(1);
  return (row?.parameters as T | null) ?? null;
}

// ============== 1. Sales Forecasting ==============
type SalesForecastParams = {
  intercept: number;
  slope: number;
  trendR2: number;
  ewmaSmoothed: number;
  recentMean: number;
  recentStd: number;
  trainedDays: number;
};

export async function trainSalesForecast(): Promise<{ accuracy: number; size: number; params: SalesForecastParams }> {
  // Daily totals from POS orders for the last 60 days
  const since = new Date();
  since.setDate(since.getDate() - 60);

  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${posOrdersTable.createdAt})::date::text`,
      total: sql<string>`sum(${posOrdersTable.total})`,
    })
    .from(posOrdersTable)
    .where(gte(posOrdersTable.createdAt, since))
    .groupBy(sql`date_trunc('day', ${posOrdersTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${posOrdersTable.createdAt})`);

  // Build a complete daily series filling missing days with 0
  const dayMap = new Map<string, number>();
  for (const r of rows) dayMap.set(r.day, Number(r.total));

  const series: number[] = [];
  for (let i = 60; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push(dayMap.get(key) ?? 0);
  }

  if (series.length < 7) {
    throw new Error("Not enough sales data to train (need at least 7 days)");
  }

  // Walk-forward validation: train on first 70%, test on last 30%
  const splitIdx = Math.floor(series.length * 0.7);
  const train = series.slice(0, splitIdx);
  const test = series.slice(splitIdx);
  const xs = train.map((_, i) => i);
  const { a, b, r2 } = linearRegression(xs, train);

  // Compute MAPE on test window
  let mapeSum = 0;
  let mapeCount = 0;
  for (let i = 0; i < test.length; i++) {
    const x = train.length + i;
    const pred = Math.max(0, a + b * x);
    const actual = test[i]!;
    if (actual > 0) {
      mapeSum += Math.abs(actual - pred) / actual;
      mapeCount++;
    }
  }
  const mape = mapeCount > 0 ? mapeSum / mapeCount : 0;
  const accuracy = Math.max(0, Math.min(1, 1 - mape));

  const recent = series.slice(-14);
  const params: SalesForecastParams = {
    intercept: a,
    slope: b,
    trendR2: r2,
    ewmaSmoothed: ewma(series, 0.3),
    recentMean: mean(recent),
    recentStd: stdDev(recent),
    trainedDays: series.length,
  };

  await setModelStatus("sales_forecast", {
    status: "ready",
    accuracy,
    trainingSize: series.length,
    parameters: params as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: series.length, params };
}

export async function predictSalesNext7Days(): Promise<
  { date: string; predicted: number; lower: number; upper: number }[]
> {
  let p = await getParams<SalesForecastParams>("sales_forecast");
  if (!p) {
    await trainSalesForecast();
    p = await getParams<SalesForecastParams>("sales_forecast");
  }
  if (!p) return [];

  const result = [];
  for (let i = 1; i <= 7; i++) {
    const x = p.trainedDays + i;
    const trendPred = p.intercept + p.slope * x;
    // Blend trend with EWMA-smoothed level (60% trend, 40% level)
    const blended = Math.max(0, 0.6 * trendPred + 0.4 * p.ewmaSmoothed);
    const margin = 1.96 * p.recentStd; // 95% interval
    const d = new Date();
    d.setDate(d.getDate() + i);
    result.push({
      date: d.toISOString().slice(0, 10),
      predicted: Math.round(blended),
      lower: Math.max(0, Math.round(blended - margin)),
      upper: Math.round(blended + margin),
    });
  }
  return result;
}

// ============== 2. Customer Churn (RFM) ==============
type ChurnParams = {
  recencyMean: number;
  recencyStd: number;
  frequencyMean: number;
  monetaryMean: number;
  totalCustomers: number;
};

export async function trainCustomerChurn(): Promise<{ accuracy: number; size: number; params: ChurnParams }> {
  // For each customer, compute Recency (days since last order), Frequency, Monetary
  const since = new Date();
  since.setDate(since.getDate() - 365);

  const rows = await db
    .select({
      customerId: posOrdersTable.customerId,
      lastOrder: sql<string>`max(${posOrdersTable.createdAt})::text`,
      orderCount: sql<number>`count(*)::int`,
      totalSpent: sql<string>`sum(${posOrdersTable.total})`,
    })
    .from(posOrdersTable)
    .where(and(gte(posOrdersTable.createdAt, since), sql`${posOrdersTable.customerId} is not null`))
    .groupBy(posOrdersTable.customerId);

  const now = Date.now();
  const recencies: number[] = [];
  const frequencies: number[] = [];
  const monetaries: number[] = [];

  for (const r of rows) {
    const recencyDays = Math.floor((now - new Date(r.lastOrder).getTime()) / 86400000);
    recencies.push(recencyDays);
    frequencies.push(Number(r.orderCount));
    monetaries.push(Number(r.totalSpent));
  }

  const params: ChurnParams = {
    recencyMean: mean(recencies),
    recencyStd: stdDev(recencies),
    frequencyMean: mean(frequencies),
    monetaryMean: mean(monetaries),
    totalCustomers: rows.length,
  };

  // Self-validate: how many "churned" predictions are correct under the rule (recency > mean + 1*std)?
  // Use silhouette-style score: ratio of clearly classified customers
  let clearCount = 0;
  for (const r of recencies) {
    const z = params.recencyStd > 0 ? (r - params.recencyMean) / params.recencyStd : 0;
    if (Math.abs(z) > 0.5) clearCount++;
  }
  const accuracy = rows.length > 0 ? clearCount / rows.length : 0;

  await setModelStatus("customer_churn", {
    status: "ready",
    accuracy,
    trainingSize: rows.length,
    parameters: params as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: rows.length, params };
}

export async function predictAtRiskCustomers(limit = 20) {
  let p = await getParams<ChurnParams>("customer_churn");
  if (!p) {
    await trainCustomerChurn();
    p = await getParams<ChurnParams>("customer_churn");
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
    .leftJoin(customersTable, eq(customersTable.id, posOrdersTable.customerId))
    .where(and(gte(posOrdersTable.createdAt, since), sql`${posOrdersTable.customerId} is not null`))
    .groupBy(posOrdersTable.customerId, customersTable.name);

  const now = Date.now();
  const scored = rows.map((r) => {
    const recencyDays = Math.floor((now - new Date(r.lastOrder).getTime()) / 86400000);
    const recencyZ = p!.recencyStd > 0 ? (recencyDays - p!.recencyMean) / p!.recencyStd : 0;
    // Higher recency z-score + low frequency = high churn risk
    const freqRatio = p!.frequencyMean > 0 ? Number(r.orderCount) / p!.frequencyMean : 1;
    const monetaryRatio = p!.monetaryMean > 0 ? Number(r.totalSpent) / p!.monetaryMean : 1;

    // Risk score 0-100: weighted combination
    const recencyScore = Math.max(0, Math.min(50, recencyZ * 20));
    const freqScore = Math.max(0, Math.min(30, (1 - freqRatio) * 30));
    const valueAdj = Math.min(20, monetaryRatio * 20);
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

// ============== 3. Fraud Detection (Z-score) ==============
type FraudParams = {
  meanOrderValue: number;
  stdOrderValue: number;
  meanItemsPerOrder: number;
  stdItemsPerOrder: number;
  hourCounts: Record<string, number>;
  totalOrders: number;
};

export async function trainFraudDetection(): Promise<{ accuracy: number; size: number; params: FraudParams }> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const orders = await db
    .select({
      id: posOrdersTable.id,
      total: posOrdersTable.total,
      itemCount: sql<number>`coalesce(jsonb_array_length(${posOrdersTable.items}), 0)::int`,
      hour: sql<number>`extract(hour from ${posOrdersTable.createdAt})::int`,
    })
    .from(posOrdersTable)
    .where(gte(posOrdersTable.createdAt, since))
    .limit(5000);

  if (orders.length < 10) {
    throw new Error("Not enough POS orders to train fraud model (need at least 10)");
  }

  const totals = orders.map((o) => Number(o.total));
  const items = orders.map((o) => o.itemCount);
  const hourCounts: Record<string, number> = {};
  for (const o of orders) {
    const h = String(o.hour);
    hourCounts[h] = (hourCounts[h] ?? 0) + 1;
  }

  const params: FraudParams = {
    meanOrderValue: mean(totals),
    stdOrderValue: stdDev(totals),
    meanItemsPerOrder: mean(items),
    stdItemsPerOrder: stdDev(items),
    hourCounts,
    totalOrders: orders.length,
  };

  // Accuracy = fraction of orders within ±2σ (model "explains" them well)
  const explained = totals.filter((t) =>
    params.stdOrderValue === 0 ? true : Math.abs((t - params.meanOrderValue) / params.stdOrderValue) <= 2,
  ).length;
  const accuracy = orders.length > 0 ? explained / orders.length : 0;

  await setModelStatus("fraud_detection", {
    status: "ready",
    accuracy,
    trainingSize: orders.length,
    parameters: params as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: orders.length, params };
}

export async function detectAnomalousOrders(limit = 20) {
  let p = await getParams<FraudParams>("fraud_detection");
  if (!p) {
    await trainFraudDetection();
    p = await getParams<FraudParams>("fraud_detection");
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
    .leftJoin(posSessionsTable, eq(posSessionsTable.id, posOrdersTable.sessionId))
    .where(gte(posOrdersTable.createdAt, since))
    .orderBy(desc(posOrdersTable.createdAt))
    .limit(2000);

  const totalOrders = Math.max(1, p.totalOrders);
  const anomalies = rows
    .map((r) => {
      const total = Number(r.total);
      const valueZ = p!.stdOrderValue > 0 ? Math.abs((total - p!.meanOrderValue) / p!.stdOrderValue) : 0;
      const itemsZ = p!.stdItemsPerOrder > 0
        ? Math.abs((r.itemCount - p!.meanItemsPerOrder) / p!.stdItemsPerOrder)
        : 0;
      const hour = new Date(r.createdAt).getHours();
      const hourFreq = (p!.hourCounts[String(hour)] ?? 0) / totalOrders;
      // Unusual hour = bottom 10% of frequency
      const hourScore = hourFreq < 0.02 ? 30 : hourFreq < 0.05 ? 15 : 0;

      const score = Math.round(Math.min(100, valueZ * 25 + itemsZ * 15 + hourScore));
      const reasons: string[] = [];
      if (valueZ > 2.5) reasons.push(`قيمة فاتورة استثنائية (z=${valueZ.toFixed(1)})`);
      if (itemsZ > 2.5) reasons.push(`عدد أصناف غير معتاد (z=${itemsZ.toFixed(1)})`);
      if (hourScore > 0) reasons.push(`وقت معاملة نادر (${hour}:00)`);

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

// ============== 4. Product Recommendations (Basket co-occurrence) ==============
type RecoParams = {
  pairs: Record<string, { otherId: number; otherName: string; count: number; lift: number }[]>;
  productSupport: Record<string, number>;
  totalBaskets: number;
};

export async function trainProductRecommendations(): Promise<{ accuracy: number; size: number; params: RecoParams }> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Each pos_orders row stores its line items in a jsonb array `items`.
  // Unnest it so each row = one (orderId, productId, productName) triple.
  const items = await db
    .select({
      orderId: posOrdersTable.id,
      productId: sql<number>`(elem->>'productId')::int`,
      productName: sql<string>`coalesce(elem->>'productName', '')`,
    })
    .from(posOrdersTable)
    .innerJoin(
      sql`jsonb_array_elements(${posOrdersTable.items}) as elem`,
      sql`true`,
    )
    .where(gte(posOrdersTable.createdAt, since))
    .limit(20000);

  const baskets = new Map<number, { id: number; name: string }[]>();
  for (const it of items) {
    if (it.productId == null) continue;
    if (!baskets.has(it.orderId)) baskets.set(it.orderId, []);
    baskets.get(it.orderId)!.push({ id: Number(it.productId), name: it.productName ?? "" });
  }

  const totalBaskets = baskets.size;
  const productSupport: Record<string, number> = {};
  const pairCounts: Record<string, Record<string, { count: number; otherName: string }>> = {};

  for (const basket of baskets.values()) {
    const seen = new Set<number>();
    for (const item of basket) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      productSupport[String(item.id)] = (productSupport[String(item.id)] ?? 0) + 1;
    }
    const arr = Array.from(seen);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!;
        const b = arr[j]!;
        const aName = basket.find((x) => x.id === a)?.name ?? "";
        const bName = basket.find((x) => x.id === b)?.name ?? "";
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

  // Compute lift for each pair: lift(A->B) = P(A,B) / (P(A)*P(B))
  const pairs: RecoParams["pairs"] = {};
  for (const a of Object.keys(pairCounts)) {
    const aSupport = (productSupport[a] ?? 1) / totalBaskets;
    const ranked = Object.entries(pairCounts[a]!)
      .map(([b, v]) => {
        const bSupport = (productSupport[b] ?? 1) / totalBaskets;
        const jointSupport = v.count / totalBaskets;
        const lift = aSupport > 0 && bSupport > 0 ? jointSupport / (aSupport * bSupport) : 0;
        return { otherId: Number(b), otherName: v.otherName, count: v.count, lift };
      })
      .filter((p) => p.count >= 2 && p.lift > 1)
      .sort((x, y) => y.lift - x.lift)
      .slice(0, 5);
    if (ranked.length > 0) pairs[a] = ranked;
  }

  // Accuracy = coverage: fraction of products that have at least 1 recommendation
  const productsWithReco = Object.keys(pairs).length;
  const totalProducts = Object.keys(productSupport).length;
  const accuracy = totalProducts > 0 ? productsWithReco / totalProducts : 0;

  const params: RecoParams = { pairs, productSupport, totalBaskets };
  await setModelStatus("product_recommendations", {
    status: "ready",
    accuracy,
    trainingSize: totalBaskets,
    parameters: params as unknown as Record<string, unknown>,
    lastTrainedAt: new Date(),
    lastError: null,
  });

  return { accuracy, size: totalBaskets, params };
}

export async function getRecommendationsForProduct(productId: number) {
  let p = await getParams<RecoParams>("product_recommendations");
  if (!p) {
    await trainProductRecommendations();
    p = await getParams<RecoParams>("product_recommendations");
  }
  if (!p) return [];
  return p.pairs[String(productId)] ?? [];
}

export async function getTopRecommendations(limit = 10) {
  let p = await getParams<RecoParams>("product_recommendations");
  if (!p) {
    await trainProductRecommendations();
    p = await getParams<RecoParams>("product_recommendations");
  }
  if (!p) return [];

  // Get product names for the source IDs too
  const sourceIds = Object.keys(p.pairs).map(Number);
  const productMap = new Map<number, string>();
  if (sourceIds.length > 0) {
    const prods = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable);
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
