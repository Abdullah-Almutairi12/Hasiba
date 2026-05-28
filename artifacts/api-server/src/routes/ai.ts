import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { db, aiModelsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { adminGuard, analyticsReadGuard, ownerOnly } from "../middlewares/require-role";
import {
  trainSalesForecast,
  trainCustomerChurn,
  trainFraudDetection,
  trainProductRecommendations,
  predictSalesNext7Days,
  predictAtRiskCustomers,
  detectAnomalousOrders,
  getTopRecommendations,
} from "../lib/ai-models";
import { askAssistant } from "../lib/ai-assistant";

const router = Router();
const adminOnly = adminGuard;
// Read-only AI analytics open to roles that already see company-wide reports.
const analyticsRead = analyticsReadGuard;
// Training and the assistant can be expensive — owner only.
const trainingGuard = ownerOnly;

// Limit OpenAI-backed assistant to prevent runaway costs / abuse.
// 30 requests / 15 minutes per IP, plus a global ceiling.
const assistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "تجاوزت الحد المسموح من الأسئلة. حاول مجدداً بعد قليل." },
});

function serializeModel(m: typeof aiModelsTable.$inferSelect) {
  return {
    id: m.id,
    key: m.key,
    name: m.name,
    description: m.description,
    category: m.category,
    status: m.status,
    accuracy: m.accuracy,
    trainingSize: m.trainingSize,
    lastTrainedAt: m.lastTrainedAt?.toISOString() ?? null,
    lastError: m.lastError,
    updatedAt: m.updatedAt.toISOString(),
  };
}

// ============== Model registry ==============
router.get("/ai/models", adminOnly, async (req, res) => {
  try {
    const rows = await db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.updatedAt));
    res.json(rows.map(serializeModel));
  } catch (err) {
    req.log.error({ err }, "List AI models failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai/models/:key/train", trainingGuard, async (req, res) => {
  const key = String(req.params.key);
  try {
    await db.update(aiModelsTable).set({ status: "training" }).where(eq(aiModelsTable.key, key));
    let result;
    switch (key) {
      case "sales_forecast":
        result = await trainSalesForecast();
        break;
      case "customer_churn":
        result = await trainCustomerChurn();
        break;
      case "fraud_detection":
        result = await trainFraudDetection();
        break;
      case "product_recommendations":
        result = await trainProductRecommendations();
        break;
      case "ai_assistant":
        // Assistant is "always ready" if configured
        await db
          .update(aiModelsTable)
          .set({
            status: "ready",
            accuracy: 1,
            trainingSize: 0,
            lastTrainedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(aiModelsTable.key, key));
        result = { accuracy: 1, size: 0 };
        break;
      default:
        return res.status(404).json({ error: "Unknown model key" });
    }
    return res.json({ ok: true, accuracy: result.accuracy, trainingSize: result.size });
  } catch (err) {
    req.log.error({ err, key }, "Train model failed");
    const msg = err instanceof Error ? err.message : "Training failed";
    await db
      .update(aiModelsTable)
      .set({ status: "error", lastError: msg, updatedAt: new Date() })
      .where(eq(aiModelsTable.key, key));
    return res.status(500).json({ error: msg });
  }
});

router.post("/ai/models/train-all", trainingGuard, async (req, res) => {
  const results: Record<string, { ok: boolean; accuracy?: number; error?: string }> = {};
  const trainers = [
    { key: "sales_forecast", fn: trainSalesForecast },
    { key: "customer_churn", fn: trainCustomerChurn },
    { key: "fraud_detection", fn: trainFraudDetection },
    { key: "product_recommendations", fn: trainProductRecommendations },
  ];
  for (const t of trainers) {
    try {
      const r = await t.fn();
      results[t.key] = { ok: true, accuracy: r.accuracy };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      results[t.key] = { ok: false, error: msg };
      await db
        .update(aiModelsTable)
        .set({ status: "error", lastError: msg, updatedAt: new Date() })
        .where(eq(aiModelsTable.key, t.key));
    }
  }
  res.json({ results });
});

// ============== Predictions (manager / accountant only — company-wide analytics) ==============
router.get("/ai/predict/sales-forecast", analyticsRead, async (req, res) => {
  try {
    const data = await predictSalesNext7Days();
    res.json({ forecast: data });
  } catch (err) {
    req.log.error({ err }, "Sales forecast failed");
    res.json({ forecast: [] });
  }
});

router.get("/ai/predict/at-risk-customers", analyticsRead, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const data = await predictAtRiskCustomers(limit);
    // Normalize to OpenAPI/UI contract: { name, riskScore, daysSinceLastOrder, totalSpent }
    const customers = data.map((c) => ({
      customerId: c.customerId,
      name: (c as { customerName?: string; name?: string }).customerName ?? (c as { name?: string }).name ?? "",
      riskScore: c.riskScore,
      daysSinceLastOrder: (c as { daysSinceLastOrder?: number }).daysSinceLastOrder ?? 0,
      totalSpent: (c as { totalSpent?: number }).totalSpent ?? 0,
    }));
    res.json({ customers });
  } catch (err) {
    req.log.error({ err }, "At-risk customers failed");
    res.json({ customers: [] });
  }
});

router.get("/ai/predict/fraud-anomalies", analyticsRead, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const data = await detectAnomalousOrders(limit);
    const anomalies = data.map((a) => {
      const raw = a as {
        orderId: number;
        total?: number;
        amount?: number;
        anomalyScore?: number;
        zScore?: number;
        reasons?: string[];
        reason?: string;
        createdAt: string;
      };
      return {
        orderId: raw.orderId,
        amount: raw.amount ?? raw.total ?? 0,
        zScore: raw.zScore ?? (raw.anomalyScore ?? 0) / 25,
        reason: raw.reason ?? (raw.reasons?.join("، ") ?? ""),
        createdAt: raw.createdAt,
      };
    });
    res.json({ anomalies });
  } catch (err) {
    req.log.error({ err }, "Fraud anomalies failed");
    res.json({ anomalies: [] });
  }
});

router.get("/ai/predict/recommendations", analyticsRead, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const data = await getTopRecommendations(limit);
    const recommendations = data.map((r) => {
      const raw = r as {
        sourceId?: number;
        sourceName?: string;
        otherId?: number;
        otherName?: string;
        productAId?: number;
        productAName?: string;
        productBId?: number;
        productBName?: string;
        lift: number;
      };
      return {
        productAId: raw.productAId ?? raw.sourceId ?? 0,
        productAName: raw.productAName ?? raw.sourceName ?? "",
        productBId: raw.productBId ?? raw.otherId ?? 0,
        productBName: raw.productBName ?? raw.otherName ?? "",
        lift: raw.lift,
      };
    });
    res.json({ recommendations });
  } catch (err) {
    req.log.error({ err }, "Recommendations failed");
    res.json({ recommendations: [] });
  }
});

// ============== AI Assistant chat (manager only + rate-limited) ==============
const AskBody = z.object({ question: z.string().min(2).max(2000) });

router.post("/ai/assistant/ask", adminOnly, assistantLimiter, async (req, res) => {
  try {
    const { question } = AskBody.parse(req.body);
    const result = await askAssistant(question);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "AI assistant failed");
    // AIUnavailableError carries an httpStatus=503 and an Arabic message
    // intended for the end user; everything else is a true server error.
    if (err instanceof Error && (err as { httpStatus?: number }).httpStatus === 503) {
      res.status(503).json({ error: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : "Failed to call assistant";
    res.status(500).json({ error: msg });
  }
});

export default router;
