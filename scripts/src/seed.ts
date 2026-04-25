import {
  db,
  branchesTable,
  warehousesTable,
  categoriesTable,
  productsTable,
  customersTable,
  posSessionsTable,
  posOrdersTable,
  invoicesTable,
  alertsTable,
  usersTable,
  journalEntriesTable,
  auditLogsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const DEFAULT_PASSWORD = "admin123";

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function daysAgo(n: number, hour = rand(8, 22), minute = rand(0, 59)) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function clear() {
  console.log("→ مسح البيانات الحالية...");
  // Drop session table if it exists (will be recreated by connect-pg-simple)
  await db.execute(sql`TRUNCATE TABLE
    pos_orders, pos_sessions, journal_entries, invoices, alerts, audit_logs,
    products, categories, warehouses, branches, customers, users
    RESTART IDENTITY CASCADE`);
  await db.execute(sql`DELETE FROM session WHERE true`).catch(() => {});
}

async function seedBranches() {
  console.log("→ إضافة الفروع...");
  return db
    .insert(branchesTable)
    .values([
      { name: "Riyadh - Olaya", nameAr: "الرياض - العليا", city: "الرياض", isActive: true },
      { name: "Jeddah - Tahliya", nameAr: "جدة - التحلية", city: "جدة", isActive: true },
      { name: "Dammam - Center", nameAr: "الدمام - الوسط", city: "الدمام", isActive: true },
      { name: "Riyadh - Malaz", nameAr: "الرياض - الملز", city: "الرياض", isActive: true },
    ])
    .returning();
}

async function seedWarehouses(branchIds: number[]) {
  console.log("→ إضافة المستودعات...");
  const rows = [
    { branchId: branchIds[0], name: "Olaya Main", nameAr: "مستودع العليا الرئيسي", isDefault: true },
    { branchId: branchIds[0], name: "Olaya Backup", nameAr: "مستودع العليا الاحتياطي", isDefault: false },
    { branchId: branchIds[1], name: "Tahliya Main", nameAr: "مستودع التحلية", isDefault: true },
    { branchId: branchIds[2], name: "Dammam Main", nameAr: "مستودع الدمام", isDefault: true },
    { branchId: branchIds[3], name: "Malaz Main", nameAr: "مستودع الملز", isDefault: true },
  ];
  return db.insert(warehousesTable).values(rows).returning();
}

async function seedCategories() {
  console.log("→ إضافة فئات المنتجات...");
  return db
    .insert(categoriesTable)
    .values([
      { name: "Coffee", nameAr: "قهوة" },
      { name: "Tea", nameAr: "شاي" },
      { name: "Pastries", nameAr: "معجنات" },
      { name: "Sandwiches", nameAr: "ساندويتشات" },
      { name: "Beverages", nameAr: "مشروبات" },
      { name: "Desserts", nameAr: "حلويات" },
    ])
    .returning();
}

async function seedProducts(categoryIds: number[]) {
  console.log("→ إضافة المنتجات...");
  const items = [
    { name: "Espresso", nameAr: "إسبريسو", sku: "COF-001", catIdx: 0, price: 12, cost: 4, stock: 200 },
    { name: "Americano", nameAr: "أمريكانو", sku: "COF-002", catIdx: 0, price: 15, cost: 5, stock: 180 },
    { name: "Latte", nameAr: "لاتيه", sku: "COF-003", catIdx: 0, price: 18, cost: 6, stock: 150 },
    { name: "Cappuccino", nameAr: "كابتشينو", sku: "COF-004", catIdx: 0, price: 18, cost: 6, stock: 140 },
    { name: "Specialty Coffee", nameAr: "قهوة مختصة", sku: "COF-005", catIdx: 0, price: 25, cost: 9, stock: 80 },
    { name: "Karak", nameAr: "كرك", sku: "TEA-001", catIdx: 1, price: 8, cost: 2, stock: 220 },
    { name: "Green Tea", nameAr: "شاي أخضر", sku: "TEA-002", catIdx: 1, price: 10, cost: 3, stock: 100 },
    { name: "Mint Tea", nameAr: "شاي بالنعناع", sku: "TEA-003", catIdx: 1, price: 9, cost: 3, stock: 90 },
    { name: "Croissant", nameAr: "كرواسون", sku: "PAS-001", catIdx: 2, price: 14, cost: 5, stock: 60 },
    { name: "Cinnamon Roll", nameAr: "سينابون", sku: "PAS-002", catIdx: 2, price: 16, cost: 6, stock: 50 },
    { name: "Croissant Cheese", nameAr: "كرواسون جبن", sku: "PAS-003", catIdx: 2, price: 18, cost: 7, stock: 4 }, // low stock
    { name: "Halloumi Sandwich", nameAr: "ساندويتش حلوم", sku: "SAN-001", catIdx: 3, price: 22, cost: 9, stock: 40 },
    { name: "Chicken Sandwich", nameAr: "ساندويتش دجاج", sku: "SAN-002", catIdx: 3, price: 25, cost: 10, stock: 35 },
    { name: "Tuna Sandwich", nameAr: "ساندويتش تونة", sku: "SAN-003", catIdx: 3, price: 24, cost: 9, stock: 3 }, // low stock
    { name: "Water 500ml", nameAr: "ماء 500مل", sku: "BEV-001", catIdx: 4, price: 3, cost: 1, stock: 500 },
    { name: "Orange Juice", nameAr: "عصير برتقال", sku: "BEV-002", catIdx: 4, price: 12, cost: 4, stock: 80 },
    { name: "Soft Drink", nameAr: "مشروب غازي", sku: "BEV-003", catIdx: 4, price: 6, cost: 2, stock: 200 },
    { name: "Cheesecake", nameAr: "تشيز كيك", sku: "DES-001", catIdx: 5, price: 28, cost: 11, stock: 25 },
    { name: "Brownie", nameAr: "براوني", sku: "DES-002", catIdx: 5, price: 18, cost: 7, stock: 30 },
    { name: "Tiramisu", nameAr: "تيراميسو", sku: "DES-003", catIdx: 5, price: 30, cost: 12, stock: 2 }, // low stock
  ];

  return db
    .insert(productsTable)
    .values(
      items.map((it) => ({
        name: it.name,
        nameAr: it.nameAr,
        sku: it.sku,
        categoryId: categoryIds[it.catIdx],
        price: String(it.price),
        costPrice: String(it.cost),
        stock: it.stock,
        minStock: 10,
        unit: "piece",
        isActive: true,
      })),
    )
    .returning();
}

async function seedCustomers() {
  console.log("→ إضافة العملاء...");
  const names = [
    "محمد العتيبي", "سارة الشمري", "خالد القحطاني", "نورة العنزي", "عبدالله الحربي",
    "ريم الدوسري", "فيصل المطيري", "هند السبيعي", "سلمان الزهراني", "ليلى الغامدي",
    "ياسر العمري", "أمل القرشي", "بدر الرشيدي", "منى البلوي", "ماجد العتيبي",
    "غادة الشهري", "تركي العوفي", "وفاء الزهراني", "نواف الجهني", "روان البقمي",
    "زياد القحطاني", "دانة الحربي", "أحمد بن خالد", "سمر العنزي", "راشد المالكي",
    "عبير الفهد", "سلطان الدوسري", "إيمان السعدون", "فهد الشهراني", "نهى المطيري",
  ];
  return db
    .insert(customersTable)
    .values(
      names.map((name, i) => ({
        name,
        phone: `+96650${String(1000000 + i * 137).slice(0, 7)}`,
        email: `customer${i + 1}@example.sa`,
      })),
    )
    .returning();
}

async function seedUsers(branchIds: number[]) {
  console.log("→ إضافة المستخدمين (كلمة مرور افتراضية: admin123)...");
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  return db
    .insert(usersTable)
    .values([
      { name: "أحمد المدير", email: "admin@hasba.ai", passwordHash: hash, role: "manager", branchId: branchIds[0], isActive: true, has2fa: true, lastLoginAt: new Date() },
      { name: "فاطمة المحاسبة", email: "accountant@hasba.ai", passwordHash: hash, role: "accountant", branchId: branchIds[0], isActive: true, has2fa: true, lastLoginAt: daysAgo(0, 9, 30) },
      { name: "خالد الكاشير", email: "cashier1@hasba.ai", passwordHash: hash, role: "cashier", branchId: branchIds[0], isActive: true, has2fa: false, lastLoginAt: daysAgo(0, 8, 15) },
      { name: "نوره الكاشير", email: "cashier2@hasba.ai", passwordHash: hash, role: "cashier", branchId: branchIds[1], isActive: true, has2fa: false, lastLoginAt: daysAgo(0, 8, 0) },
      { name: "سعد المراجع", email: "auditor@hasba.ai", passwordHash: hash, role: "auditor", branchId: null, isActive: true, has2fa: true, lastLoginAt: daysAgo(1) },
      { name: "ريم الكاشير", email: "cashier3@hasba.ai", passwordHash: hash, role: "cashier", branchId: branchIds[2], isActive: true, has2fa: false, lastLoginAt: daysAgo(0, 14, 20) },
      { name: "بدر المدير", email: "manager2@hasba.ai", passwordHash: hash, role: "manager", branchId: branchIds[2], isActive: true, has2fa: true, lastLoginAt: daysAgo(0, 10, 0) },
      { name: "هاجر المحاسبة", email: "accountant2@hasba.ai", passwordHash: hash, role: "accountant", branchId: branchIds[1], isActive: false, has2fa: false, lastLoginAt: daysAgo(15) },
    ])
    .returning();
}

async function seedSessionsAndOrders(branchIds: number[], products: { id: number; price: string }[]) {
  console.log("→ إضافة جلسات ومبيعات نقطة البيع (آخر 30 يوم)...");
  const cashiers = ["خالد العنزي", "نوره الحربي", "ريم الدوسري", "أحمد بن خالد", "فيصل المطيري"];
  const paymentMethods = ["cash", "card", "transfer"];

  // For each of the last 30 days, create 1-2 sessions per branch and 5-15 orders per session
  for (let day = 29; day >= 0; day--) {
    for (let bi = 0; bi < branchIds.length; bi++) {
      const branchId = branchIds[bi];
      // Branch 0 gets more sessions
      const sessionsPerDay = bi === 0 ? 2 : 1;
      for (let s = 0; s < sessionsPerDay; s++) {
        const opened = daysAgo(day, 7 + s * 8, 0);
        const sessionNumber = `SES-${day}-${bi}-${s}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const [session] = await db
          .insert(posSessionsTable)
          .values({
            sessionNumber,
            branchId,
            cashierName: pick(cashiers),
            openingCash: "500.00",
            status: day === 0 ? "open" : "closed",
          })
          .returning();

        const orderCount = rand(8, 20);
        const orderRows: Array<typeof posOrdersTable.$inferInsert> = [];
        let sessionTotal = 0;

        for (let o = 0; o < orderCount; o++) {
          const itemCount = rand(1, 4);
          const items: Array<{ productId: number; nameAr: string; quantity: number; price: number }> = [];
          let subtotal = 0;
          for (let i = 0; i < itemCount; i++) {
            const p = pick(products);
            const qty = rand(1, 3);
            const price = Number(p.price);
            items.push({ productId: p.id, nameAr: (p as any).nameAr ?? "", quantity: qty, price });
            subtotal += price * qty;
          }
          const tax = +(subtotal * 0.15).toFixed(2);
          const total = +(subtotal + tax).toFixed(2);
          sessionTotal += total;

          orderRows.push({
            orderNumber: `ORD-${day}-${bi}-${s}-${o}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            sessionId: session.id,
            customerId: null,
            items: items as any,
            subtotal: String(subtotal.toFixed(2)),
            tax: String(tax),
            discount: "0",
            total: String(total),
            paymentMethod: pick(paymentMethods),
            createdAt: daysAgo(day, opened.getHours() + Math.floor(o / 4), rand(0, 59)),
          });
        }

        await db.insert(posOrdersTable).values(orderRows);
        await db
          .update(posSessionsTable)
          .set({
            totalSales: String(sessionTotal.toFixed(2)),
            ordersCount: orderCount,
          })
          .where(sql`${posSessionsTable.id} = ${session.id}`);
      }
    }
  }
}

async function seedInvoices() {
  console.log("→ إضافة فواتير الموردين...");
  const suppliers = ["مؤسسة البن الذهبي", "شركة الألبان السعودية", "موزع المعجنات", "شركة المياه الصافية", "مورد الأكواب"];
  const statuses = ["pending", "processing", "approved", "needs_review"];
  const rows = [];
  for (let i = 0; i < 30; i++) {
    rows.push({
      invoiceNumber: `INV-${2026000 + i}`,
      supplierName: pick(suppliers),
      amount: String(rand(500, 15000) + 0.5),
      status: pick(statuses),
      confidence: Math.random() > 0.3 ? 0.8 + Math.random() * 0.2 : null,
      dueDate: daysAgo(-rand(5, 30)),
    });
  }
  await db.insert(invoicesTable).values(rows);
}

async function seedAlerts() {
  console.log("→ إضافة التنبيهات...");
  await db.insert(alertsTable).values([
    { type: "warning", title: "مخزون منخفض", message: "تيراميسو على وشك النفاد - متبقي 2 قطعة", isRead: false },
    { type: "warning", title: "مخزون منخفض", message: "ساندويتش تونة على وشك النفاد - متبقي 3 قطع", isRead: false },
    { type: "info", title: "تحديث ZATCA", message: "تم تحديث رمز الفوترة الإلكترونية بنجاح", isRead: true },
    { type: "success", title: "نمو المبيعات", message: "ارتفعت مبيعات اليوم بنسبة 12% عن الأمس", isRead: false },
    { type: "danger", title: "نشاط مشبوه", message: "إلغاء فاتورة بقيمة كبيرة بدون مبرر - فرع جدة", isRead: false },
  ]);
}

async function seedJournalEntries() {
  console.log("→ إضافة قيود محاسبية...");
  const rows = [];
  const accounts = [
    { d: "النقدية", c: "إيرادات المبيعات" },
    { d: "حسابات العملاء", c: "إيرادات المبيعات" },
    { d: "تكلفة البضاعة المباعة", c: "المخزون" },
    { d: "مصاريف الرواتب", c: "النقدية" },
    { d: "مصاريف الكهرباء", c: "النقدية" },
    { d: "ضريبة القيمة المضافة", c: "النقدية" },
  ];
  for (let i = 0; i < 25; i++) {
    const a = pick(accounts);
    rows.push({
      description: `قيد ${i + 1} - ${a.d}`,
      debitAccount: a.d,
      creditAccount: a.c,
      amount: String(rand(500, 25000)),
      date: daysAgo(rand(0, 60)),
      reference: `JE-${2026000 + i}`,
      isAutomatic: i % 3 === 0,
    });
  }
  await db.insert(journalEntriesTable).values(rows);
}

async function seedAuditLogs() {
  console.log("→ إضافة سجلات التدقيق...");
  const actions = [
    { action: "login", entity: "auth", details: "تسجيل دخول ناجح", severity: "info" },
    { action: "create", entity: "invoice", details: "إنشاء فاتورة جديدة", severity: "info" },
    { action: "delete", entity: "product", details: "حذف منتج من الكتالوج", severity: "warning" },
    { action: "update", entity: "user", details: "تعديل صلاحيات مستخدم", severity: "warning" },
    { action: "failed_login", entity: "auth", details: "محاولة تسجيل دخول فاشلة", severity: "danger" },
    { action: "export", entity: "report", details: "تصدير تقرير المبيعات", severity: "info" },
  ];
  const users = ["أحمد المدير", "فاطمة المحاسبة", "خالد الكاشير", "نوره الكاشير", "سعد المراجع"];
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const a = pick(actions);
    rows.push({
      userId: rand(1, 5),
      userName: pick(users),
      action: a.action,
      entity: a.entity,
      details: a.details,
      ipAddress: `192.168.1.${rand(2, 250)}`,
      severity: a.severity,
      createdAt: daysAgo(rand(0, 30)),
    });
  }
  await db.insert(auditLogsTable).values(rows);
}

async function main() {
  console.log("🌱 بدء زرع البيانات التجريبية...\n");
  await clear();
  const branches = await seedBranches();
  const branchIds = branches.map((b) => b.id);
  await seedWarehouses(branchIds);
  const categories = await seedCategories();
  const products = await seedProducts(categories.map((c) => c.id));
  await seedCustomers();
  await seedUsers(branchIds);
  await seedSessionsAndOrders(branchIds, products);
  await seedInvoices();
  await seedAlerts();
  await seedJournalEntries();
  await seedAuditLogs();
  console.log("\n✅ تم زرع البيانات بنجاح!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ فشل زرع البيانات:", err);
  process.exit(1);
});
