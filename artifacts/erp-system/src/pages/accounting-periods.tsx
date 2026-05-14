import { FiscalPeriodsTab } from "@/pages/accounting";

export default function AccountingPeriodsPage() {
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">الفترات المالية</h1>
        <p className="text-sm text-muted-foreground">
          إدارة السنوات المالية والفترات الشهرية وإقفال السنة.
        </p>
      </div>
      <FiscalPeriodsTab />
    </div>
  );
}
