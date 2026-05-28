import { db, posOrdersTable, productsTable, customersTable, branchesTable, invoicesTable } from "@workspace/db";
import { sql, desc, gte } from "drizzle-orm";
import { getOpenAI, isOpenAIConfigured, tryAI } from "./openai-client";

// Build a compact context from the user's actual ERP data
async function buildBusinessContext(): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [salesRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${posOrdersTable.total}), 0)`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(posOrdersTable)
    .where(gte(posOrdersTable.createdAt, since));

  const topProducts = await db
    .select({
      name: productsTable.name,
      stock: productsTable.stock,
      price: productsTable.price,
    })
    .from(productsTable)
    .orderBy(desc(productsTable.stock))
    .limit(10);

  const [customerCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(customersTable);

  const branches = await db.select({ name: branchesTable.name, city: branchesTable.city }).from(branchesTable);

  const [openInv] = await db
    .select({ c: sql<number>`(count(*) filter (where ${invoicesTable.status} != 'done'))::int` })
    .from(invoicesTable);

  const lines: string[] = [
    `إجمالي مبيعات آخر 30 يوماً: ${Number(salesRow?.total ?? 0).toLocaleString("ar-SA")} ريال`,
    `عدد طلبات نقاط البيع آخر 30 يوماً: ${salesRow?.orderCount ?? 0}`,
    `عدد العملاء المسجلين: ${customerCount?.c ?? 0}`,
    `عدد الفروع: ${branches.length} (${branches.map((b) => `${b.name} - ${b.city}`).join("، ")})`,
    `عدد فواتير الموردين قيد المعالجة: ${openInv?.c ?? 0}`,
    `أهم 10 منتجات حسب المخزون:`,
    ...topProducts.map(
      (p) => `  - ${p.name}: ${p.stock} قطعة بسعر ${Number(p.price).toFixed(2)} ريال`,
    ),
  ];
  return lines.join("\n");
}

export async function askAssistant(question: string): Promise<{ answer: string; tokensUsed?: number }> {
  if (!isOpenAIConfigured()) {
    return { answer: "المساعد الذكي غير مهيأ. تواصل مع مدير النظام." };
  }
  const ctx = await buildBusinessContext();

  // Wrap the upstream call so quota / 5xx / timeout failures surface as a
  // single AIUnavailableError → route handler maps to 503 with Arabic copy.
  const completion = await tryAI(() => {
    const openai = getOpenAI();
    return openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: `أنت مساعد ذكي لنظام ERP عربي اسمه "حاسبة.AI". تجيب باللغة العربية الفصحى المختصرة. لديك وصول للبيانات التالية من شركة المستخدم:

${ctx}

قواعد:
- استخدم الأرقام الفعلية من السياق أعلاه عند الإجابة.
- إذا سُئلت عن شيء غير موجود في السياق، قل ذلك صراحة.
- أعطِ توصيات عملية مدعومة بالأرقام.
- اجعل الإجابات قصيرة (3-6 أسطر).`,
      },
      { role: "user", content: question },
    ],
    });
  });

  const answer = completion.choices[0]?.message?.content ?? "لم أتمكن من توليد إجابة.";
  return { answer, tokensUsed: completion.usage?.total_tokens };
}
