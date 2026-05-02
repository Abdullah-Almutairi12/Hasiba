import { Router } from "express";
import { db, journalEntriesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { CreateJournalEntryBody } from "@workspace/api-zod";
import { financeGuard, reportReadGuard } from "../middlewares/require-role";

const router = Router();

router.get("/accounting/journal-entries", reportReadGuard, async (req, res) => {
  try {
    const entries = await db
      .select()
      .from(journalEntriesTable)
      .orderBy(desc(journalEntriesTable.date))
      .limit(50);

    res.json(
      entries.map((e) => ({
        ...e,
        amount: Number(e.amount),
        date: e.date.toISOString(),
        createdAt: e.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching journal entries");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/accounting/journal-entries", financeGuard, async (req, res) => {
  try {
    const body = CreateJournalEntryBody.parse(req.body);
    const [entry] = await db
      .insert(journalEntriesTable)
      .values({
        description: body.description,
        debitAccount: body.debitAccount,
        creditAccount: body.creditAccount,
        amount: String(body.amount),
        date: new Date(body.date),
        reference: body.reference ?? null,
        isAutomatic: false,
      })
      .returning();

    res.status(201).json({
      ...entry,
      amount: Number(entry.amount),
      date: entry.date.toISOString(),
      createdAt: entry.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating journal entry");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/accounting/summary", reportReadGuard, async (req, res) => {
  try {
    res.json({
      netCashFlow: 142500,
      cashFlowChange: 12.5,
      receivables: 45200,
      receivablesCount: 5,
      payables: 28900,
      avgPaymentDays: 14,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching accounting summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/accounting/zatca-status", reportReadGuard, async (req, res) => {
  try {
    res.json({
      connected: true,
      certExpiry: 290,
      lastSync: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching ZATCA status");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
