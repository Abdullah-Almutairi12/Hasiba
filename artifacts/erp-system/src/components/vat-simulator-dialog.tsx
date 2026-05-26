import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { useSimulateVatTrajectory } from "@workspace/api-client-react";
import { useLanguage } from "@/hooks/use-language";
import { TrendingUp, Sparkles, Loader2 } from "lucide-react";

interface VatSimulatorDialogProps {
  baseline: number;
  triggerLabel?: string;
}

/**
 * Task #259 — VAT Simulator. Lets the operator project rolling-12m
 * sales forward against the ZATCA voluntary (187,500) and mandatory
 * (375,000) lines, and see the estimated monthly VAT-collection cash
 * impact at the chosen growth rate. Disclaimer-only, never used for
 * filing.
 */
export function VatSimulatorDialog({
  baseline,
  triggerLabel,
}: VatSimulatorDialogProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [growth, setGrowth] = useState(8); // % per month
  const [months, setMonths] = useState(12);
  const [boost, setBoost] = useState(0);
  const [cashRate, setCashRate] = useState(10); // % of sales
  const [baselineOverride, setBaselineOverride] = useState<string>("");

  const mut = useSimulateVatTrajectory();

  const run = () => {
    const baselineVal =
      baselineOverride.trim() === ""
        ? baseline
        : Math.max(0, Number(baselineOverride));
    mut.mutate({
      data: {
        baselineRolling12mSales: baselineVal,
        monthlyGrowthRate: growth / 100,
        months,
        oneOffBoost: boost,
        cashImpactRate: cashRate / 100,
      },
    });
  };

  const data = mut.data;

  const chartData = useMemo(
    () =>
      (data?.trajectory ?? []).map((p) => ({
        month: p.month,
        sales: Math.round(p.rolling12mSales),
        cash: Math.round(p.estimatedMonthlyVatCash),
      })),
    [data],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2"
          data-testid="button-vat-simulator-open"
        >
          <TrendingUp className="size-4" />
          {triggerLabel ?? t("vat.simulator.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-teal-500" />
            {t("vat.simulator.title")}
          </DialogTitle>
          <DialogDescription>
            {t("vat.simulator.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">{t("vat.simulator.baseline")}</Label>
            <Input
              type="number"
              min={0}
              placeholder={baseline.toLocaleString()}
              value={baselineOverride}
              onChange={(e) => setBaselineOverride(e.target.value)}
              data-testid="input-vat-sim-baseline"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">
              {t("vat.simulator.growth")} ({growth}%)
            </Label>
            <Slider
              min={-20}
              max={50}
              step={1}
              value={[growth]}
              onValueChange={(v) => setGrowth(v[0] ?? 0)}
              data-testid="slider-vat-sim-growth"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">
              {t("vat.simulator.months")} ({months})
            </Label>
            <Slider
              min={3}
              max={36}
              step={1}
              value={[months]}
              onValueChange={(v) => setMonths(v[0] ?? 12)}
              data-testid="slider-vat-sim-months"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">
              {t("vat.simulator.cashRate")} ({cashRate}%)
            </Label>
            <Slider
              min={0}
              max={30}
              step={1}
              value={[cashRate]}
              onValueChange={(v) => setCashRate(v[0] ?? 10)}
              data-testid="slider-vat-sim-cash"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs">{t("vat.simulator.boost")}</Label>
            <Input
              type="number"
              min={0}
              value={boost}
              onChange={(e) => setBoost(Math.max(0, Number(e.target.value)))}
              data-testid="input-vat-sim-boost"
            />
          </div>
        </div>

        <Button
          onClick={run}
          disabled={mut.isPending}
          data-testid="button-vat-sim-run"
        >
          {mut.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {t("vat.simulator.run")}
        </Button>

        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">
                  {t("vat.simulator.voluntaryCrossed")}
                </div>
                <div className="font-mono">
                  {data.voluntaryCrossedAtMonth === null
                    ? "—"
                    : `${t("vat.simulator.month")} ${data.voluntaryCrossedAtMonth}`}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">
                  {t("vat.simulator.mandatoryCrossed")}
                </div>
                <div className="font-mono">
                  {data.mandatoryCrossedAtMonth === null
                    ? "—"
                    : `${t("vat.simulator.month")} ${data.mandatoryCrossedAtMonth}`}
                </div>
              </div>
            </div>

            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v: number) => v.toLocaleString()}
                    labelFormatter={(l) => `${t("vat.simulator.month")} ${l}`}
                  />
                  <ReferenceLine
                    y={data.voluntaryThreshold}
                    stroke="#0891b2"
                    strokeDasharray="3 3"
                  />
                  <ReferenceLine
                    y={data.mandatoryThreshold}
                    stroke="#dc2626"
                    strokeDasharray="3 3"
                  />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    stroke="#0d9488"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("vat.simulator.disclaimer")}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("vat.simulator.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
