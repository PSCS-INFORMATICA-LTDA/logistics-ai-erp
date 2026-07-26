"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import {
  billablePerDiemTotal,
  buildPerDiemDays,
  applyDefaultRatesToDays,
  isPerDiemClientCharge,
  normalizePerDiemDetail,
  perDiemChargeLabel,
  perDiemDayTotal,
  perDiemGrandTotal,
  PER_DIEM_DISTANCE_THRESHOLD_KM,
  requiresPerDiem,
  suggestTravelDays,
  type FreightPerDiemDay,
} from "@/lib/freight-per-diem";
import { formatCurrency } from "@/lib/utils";

type Props = {
  distanceKm: number;
  travelDays: string | number;
  perDiemDetail: FreightPerDiemDay[] | null;
  perDiemTotal: string | number;
  chargeTo: string;
  baseAmount: number;
  set: (key: string, value: unknown) => void;
  onSuggestedTotalChange?: (value: number) => void;
};

function parseAmount(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function FreightPerDiemPanel({
  distanceKm,
  travelDays,
  perDiemDetail,
  perDiemTotal,
  chargeTo,
  baseAmount,
  set,
  onSuggestedTotalChange,
}: Props) {
  const [defaultLodging, setDefaultLodging] = useState("");
  const [defaultBreakfast, setDefaultBreakfast] = useState("");
  const [defaultMeals, setDefaultMeals] = useState("");
  const [defaultDinner, setDefaultDinner] = useState("");
  const [defaultAllowance, setDefaultAllowance] = useState("");

  const days = useMemo(
    () => normalizePerDiemDetail(perDiemDetail),
    [perDiemDetail]
  );

  const travelDayCount = Math.max(0, Number(travelDays) || 0);
  const grandTotal = perDiemGrandTotal(days);
  const storedTotal = parseAmount(perDiemTotal);
  const billableTotal = billablePerDiemTotal(grandTotal || storedTotal, chargeTo);
  const clientCharge = isPerDiemClientCharge(chargeTo);

  const syncTotals = (
    nextDays: FreightPerDiemDay[],
    nextTravelDays: number,
    nextChargeTo: string = chargeTo
  ) => {
    const total = perDiemGrandTotal(nextDays);
    const billable = billablePerDiemTotal(total, nextChargeTo);
    set("freight_per_diem_detail", nextDays);
    set("freight_per_diem_total", total);
    set("freight_travel_days", nextTravelDays || null);
    const suggested = Math.round((baseAmount + billable) * 100) / 100;
    set("freight_suggested_total", suggested);
    onSuggestedTotalChange?.(suggested);
  };

  const handleChargeChange = (clientCharge: boolean) => {
    const nextChargeTo = clientCharge ? "Cliente" : "GRX";
    set("freight_per_diem_charge_to", nextChargeTo);
    syncTotals(days, travelDayCount, nextChargeTo);
  };

  const updateDays = (nextDays: FreightPerDiemDay[]) => {
    syncTotals(nextDays, travelDayCount);
  };

  const updateDayField = (
    dayNumber: number,
    field: keyof Omit<FreightPerDiemDay, "day">,
    value: string
  ) => {
    const nextDays = buildPerDiemDays(travelDayCount, days).map((day) =>
      day.day === dayNumber ? { ...day, [field]: parseAmount(value) } : day
    );
    updateDays(nextDays);
  };

  const handleTravelDaysChange = (value: string) => {
    const count = Math.max(0, Number(value) || 0);
    set("freight_travel_days", count || "");
    if (count <= 0) {
      set("freight_per_diem_detail", []);
      set("freight_per_diem_total", null);
      const suggested = Math.round(baseAmount * 100) / 100;
      set("freight_suggested_total", suggested);
      onSuggestedTotalChange?.(suggested);
      return;
    }
    syncTotals(buildPerDiemDays(count, days), count);
  };

  const applyDefaultsToAllDays = () => {
    const count = travelDayCount || suggestTravelDays(distanceKm);
    if (count <= 0) return;
    const nextDays = applyDefaultRatesToDays(buildPerDiemDays(count, days), {
      lodging: parseAmount(defaultLodging),
      breakfast: parseAmount(defaultBreakfast),
      meals: parseAmount(defaultMeals),
      dinner: parseAmount(defaultDinner),
      daily_allowance: parseAmount(defaultAllowance),
    });
    syncTotals(nextDays, count);
    set("freight_travel_days", count);
  };

  useEffect(() => {
    if (!requiresPerDiem(distanceKm)) return;
    if (travelDayCount > 0) return;
    const suggestedDays = suggestTravelDays(distanceKm);
    if (suggestedDays <= 0) return;
    syncTotals(buildPerDiemDays(suggestedDays, days), suggestedDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceKm]);

  if (!requiresPerDiem(distanceKm)) return null;

  const displayDays = buildPerDiemDays(travelDayCount || suggestTravelDays(distanceKm), days);

  return (
    <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 sm:col-span-2">
      <div>
        <p className="text-sm font-medium text-slate-800">
          Despesas de viagem — rota longa ({PER_DIEM_DISTANCE_THRESHOLD_KM}+ km)
        </p>
        <p className="text-xs text-slate-500">
          Distância {distanceKm} km — informe hospedagem, café da manhã, almoço, jantar e diária por
          dia de pernoite na estrada.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4 rounded-md border border-slate-200 bg-white p-3">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={clientCharge}
            onChange={(e) => handleChargeChange(e.target.checked)}
          />
          <span className="text-sm text-slate-700">
            <span className="font-medium">Despesa a cargo do cliente</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Marcado: repassa na proposta e no valor sugerido. Desmarcado: custo interno GRX.
            </span>
          </span>
        </label>
        <p className="text-sm text-slate-600">
          Responsável: <strong>{perDiemChargeLabel(chargeTo)}</strong>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Dias de viagem</span>
          <input
            type="number"
            min={1}
            step={1}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={String(travelDays ?? suggestTravelDays(distanceKm))}
            onChange={(e) => handleTravelDaysChange(e.target.value)}
          />
          <span className="text-xs text-slate-500">
            Sugestão automática: {suggestTravelDays(distanceKm)} dia(s)
          </span>
        </label>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="text-sm font-medium text-slate-700">Valores padrão por dia</p>
        <p className="mt-1 text-xs text-slate-500">
          Preencha e aplique a todos os dias — depois ajuste dia a dia se necessário.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Hospedagem (R$)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={defaultLodging}
              onChange={(e) => setDefaultLodging(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Café da manhã (R$)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={defaultBreakfast}
              onChange={(e) => setDefaultBreakfast(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Almoço (R$)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={defaultMeals}
              onChange={(e) => setDefaultMeals(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Jantar (R$)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={defaultDinner}
              onChange={(e) => setDefaultDinner(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Diária (R$)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={defaultAllowance}
              onChange={(e) => setDefaultAllowance(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button type="button" variant="secondary" onClick={applyDefaultsToAllDays}>
              Aplicar a todos
            </Button>
          </div>
        </div>
      </div>

      {displayDays.length > 0 && (
        <DataTableScroll
          stickyFirst
          compact
          fitWidth={false}
          hint="No celular, arraste na horizontal para editar Hospedagem / Café / Almoço / Jantar / Diária."
        >
          <table className="w-full min-w-[36rem] text-left text-[11px] leading-snug sm:text-xs">
            <thead className="bg-slate-50 text-[10px] text-slate-600 sm:text-xs">
              <tr>
                <th className="px-1.5 py-2 font-medium">Dia</th>
                <th className="px-1.5 py-2 font-medium">Hospedagem</th>
                <th className="px-1.5 py-2 font-medium">Café</th>
                <th className="px-1.5 py-2 font-medium">Almoço</th>
                <th className="px-1.5 py-2 font-medium">Jantar</th>
                <th className="px-1.5 py-2 font-medium">Diária</th>
                <th className="px-1.5 py-2 font-medium text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {displayDays.map((day) => (
                <tr key={day.day} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-1.5 py-2 font-medium text-slate-800">
                    Dia {day.day}
                  </td>
                  {(["lodging", "breakfast", "meals", "dinner", "daily_allowance"] as const).map(
                    (field) => (
                      <td key={field} className="px-1.5 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-full min-w-[4rem] rounded border border-slate-200 px-1.5 py-1 text-[11px] sm:text-sm"
                          value={String(day[field] ?? "")}
                          onChange={(e) => updateDayField(day.day, field, e.target.value)}
                        />
                      </td>
                    )
                  )}
                  <td className="whitespace-nowrap px-1.5 py-2 text-right font-medium text-slate-800">
                    {formatCurrency(perDiemDayTotal(day))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableScroll>
      )}

      <div className="grid gap-2 rounded-md border border-emerald-200 bg-white p-3 text-sm sm:grid-cols-2">
        <p>
          Total despesas de viagem:{" "}
          <strong>{formatCurrency(grandTotal || storedTotal)}</strong>
        </p>
        <p>
          Repassado ao cliente: <strong>{formatCurrency(billableTotal)}</strong>
        </p>
        <p className="sm:col-span-2">
          Total sugerido (base + repasse cliente):{" "}
          <strong>{formatCurrency(baseAmount + billableTotal)}</strong>
        </p>
      </div>
    </div>
  );
}
