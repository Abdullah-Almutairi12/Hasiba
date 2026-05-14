import MarketplacesTab from "@/components/marketplaces-tab";

export default function IntegrationsMarketplacesPage() {
  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">المتاجر الإلكترونية</h1>
        <p className="text-sm text-muted-foreground">
          ربط متاجر سلة وزد وShopify: دفع المنتجات، سحب الطلبات والعملاء، ومزامنة المخزون.
        </p>
      </header>
      <MarketplacesTab />
    </div>
  );
}
