"use client";

import { IsoBarChart3D, GRX_BAR_COLORS } from "@/components/dashboard/IsoBarChart3D";
import type { BucketTotals, MonthlyPoint } from "@/lib/dashboard-metrics";
import { formatCurrency } from "@/lib/utils";

type Props = {
  title?: string;
  subtitle?: string;
  totals: BucketTotals;
  trend: MonthlyPoint[];
};

export function DashboardModuleCard({ title, subtitle, totals, trend }: Props) {
  const items = [
    { key: "rec", label: "Receita", value: totals.revenue, ...GRX_BAR_COLORS.revenue },
    { key: "desp", label: "Despesa", value: totals.expense, ...GRX_BAR_COLORS.expense },
    { key: "res", label: "Resultado", value: totals.result, ...GRX_BAR_COLORS.result },
  ];

  const sparkMax = Math.max(1, ...trend.map((t) => Math.abs(t.result)));

  return (
    <div className="space-y-3">
      {title || subtitle ? (
        <div>
          {title ? <h3 className="text-sm font-semibold text-slate-900">{title}</h3> : null}
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      ) : null}
      <IsoBarChart3D items={items} />
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="text-slate-500">Receita</p>
          <p className="font-semibold text-emerald-700">{formatCurrency(totals.revenue)}</p>
        </div>
        <div>
          <p className="text-slate-500">Despesa</p>
          <p className="font-semibold text-red-700">{formatCurrency(totals.expense)}</p>
        </div>
        <div>
          <p className="text-slate-500">Resultado</p>
          <p
            className={`font-semibold ${totals.result >= 0 ? "text-sky-700" : "text-red-700"}`}
          >
            {formatCurrency(totals.result)}
          </p>
        </div>
      </div>
      {trend.length > 1 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Tendência do resultado
          </p>
          <svg viewBox={`0 0 ${trend.length * 28} 36`} className="h-9 w-full">
            {trend.map((p, i) => {
              const h = Math.max(2, (Math.abs(p.result) / sparkMax) * 28);
              const y = 32 - h;
              return (
                <rect
                  key={p.key}
                  x={i * 28 + 6}
                  y={y}
                  width={14}
                  height={h}
                  rx={2}
                  fill={p.result >= 0 ? "#0ea5e9" : "#d0001f"}
                  opacity={0.85}
                />
              );
            })}
          </svg>
        </div>
      ) : null}
    </div>
  );
}
