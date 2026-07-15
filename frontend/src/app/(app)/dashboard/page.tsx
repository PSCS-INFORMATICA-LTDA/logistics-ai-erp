"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DashboardModuleCard } from "@/components/dashboard/DashboardModuleCard";
import {
  DashboardProductNav,
  type DashboardProductTab,
} from "@/components/dashboard/DashboardProductNav";
import { PieChart3D } from "@/components/dashboard/PieChart3D";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useCompany } from "@/lib/company-context";
import {
  fetchDashboardSnapshot,
  resetDashboardDemo,
  seedDashboardDemo,
} from "@/lib/dashboard-api";
import type {
  DashboardFilters,
  DashboardPeriodKey,
  DashboardSnapshot,
} from "@/lib/dashboard-metrics";
import { periodRange } from "@/lib/dashboard-metrics";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

const PERIOD_OPTIONS: { value: DashboardPeriodKey; label: string }[] = [
  { value: "last_4_months", label: "Últimos 4 meses" },
  { value: "last_3_months", label: "Últimos 3 meses" },
  { value: "current_month", label: "Mês atual" },
  { value: "previous_month", label: "Mês anterior" },
  { value: "custom", label: "Personalizado (datas)" },
];

const EMPTY_FILTERS: DashboardFilters = {
  plate: "",
  partnerId: "",
  ownershipPct: "",
};

/** Cores sólidas no estilo pizza 3D explodida (azul / branco / vermelho…). */
const PRODUCT_COLORS = {
  frete: "#1e3a8a",
  estacionamento: "#f97316",
  lava: "#ef4444",
} as const;

const PARTNER_COLORS = ["#1e3a8a", "#f97316", "#ef4444", "#22c55e", "#eab308"] as const;

function KpiStrip({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: "Receita", value: snapshot.kpis.revenue, tone: "text-emerald-700" },
        { label: "Despesa", value: snapshot.kpis.expense, tone: "text-red-700" },
        {
          label: "Resultado",
          value: snapshot.kpis.result,
          tone: snapshot.kpis.result >= 0 ? "text-sky-700" : "text-red-700",
        },
        {
          label: "Margem",
          value: snapshot.kpis.marginPct,
          tone: "text-slate-800",
          isPct: true,
        },
      ].map((kpi) => (
        <div key={kpi.label} className={`rounded-xl px-3 py-2 ${glassFilterPanel()}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {kpi.label}
          </p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${kpi.tone}`}>
            {"isPct" in kpi && kpi.isPct
              ? `${kpi.value.toFixed(1)}%`
              : formatCurrency(kpi.value)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {snapshot.from} → {snapshot.to}
          </p>
        </div>
      ))}
    </div>
  );
}

function OwnershipBlock({
  snapshot,
  hideChart = false,
}: {
  snapshot: DashboardSnapshot;
  hideChart?: boolean;
}) {
  return (
    <div className={`space-y-3 ${glassFilterPanel()}`}>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          {hideChart ? "Detalhe do rateio por placa" : "Participações societárias"}
        </h3>
        <p className="text-xs text-slate-500">
          Rateio do frete por placa × % (use os filtros de placa/sócio/%).
        </p>
      </div>
      {!hideChart ? (
        <PieChart3D
          slices={snapshot.participationByPartner.map((p) => ({
            key: p.partnerId,
            label: p.partnerName,
            value: Math.max(0, p.result),
          }))}
        />
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Sócio</th>
              <th className="px-2 py-2">Placa</th>
              <th className="px-2 py-2">%</th>
              <th className="px-2 py-2">Receita</th>
              <th className="px-2 py-2">Despesa</th>
              <th className="px-2 py-2">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.participationRows.map((row) => (
              <tr
                key={`${row.partnerId}-${row.vehicleId}`}
                className="border-t border-slate-100"
              >
                <td className="px-2 py-2 font-medium">
                  {row.partnerName}
                  {row.isFullOwner ? (
                    <span className="ml-2 inline-block">
                      <Badge variant="success">100%</Badge>
                    </span>
                  ) : Math.abs(row.ownershipPct - 50) < 0.51 ? (
                    <span className="ml-2 inline-block">
                      <Badge variant="default">50%</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-2">{row.plate}</td>
                <td className="px-2 py-2">{row.ownershipPct.toFixed(0)}%</td>
                <td className="px-2 py-2">{formatCurrency(row.revenue)}</td>
                <td className="px-2 py-2">{formatCurrency(row.expense)}</td>
                <td className="px-2 py-2 font-medium">{formatCurrency(row.result)}</td>
              </tr>
            ))}
            {snapshot.participationRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                  Nenhum rateio para os filtros selecionados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const initialRange = useMemo(() => periodRange("last_4_months"), []);
  const [period, setPeriod] = useState<DashboardPeriodKey>("last_4_months");
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [product, setProduct] = useState<DashboardProductTab>("geral");
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const masterUnlocked = companyId ? isMasterSessionUnlocked(companyId) : false;

  const applyPeriodPreset = (next: DashboardPeriodKey) => {
    setPeriod(next);
    if (next !== "custom") {
      const range = periodRange(next);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  };

  const applyCustomDate = (which: "from" | "to", value: string) => {
    setPeriod("custom");
    if (which === "from") setDateFrom(value);
    else setDateTo(value);
  };

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const { snapshot: next, error: loadError } = await fetchDashboardSnapshot(
      supabase,
      companyId,
      period,
      filters,
      { from: dateFrom, to: dateTo }
    );
    if (loadError) setError(loadError);
    setSnapshot(next);
    setLoading(false);
  }, [companyId, period, filters, dateFrom, dateTo, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSeedDemo = async () => {
    if (!companyId) return;
    if (
      !confirm(
        "Carregar base DEMO volumosa (últimos 4 meses, frete diário manhã/tarde, estacionamento e lava)? Participações das placas DEMO vão para 50/50 (GHR 100% GRX). Lançamentos [DEMO-DASH] podem ser removidos depois."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    const seedError = await seedDashboardDemo(supabase, companyId);
    setBusy(false);
    if (seedError) {
      setError(
        seedError.includes("seed_dashboard_demo") || seedError.includes("does not exist")
          ? "Execute o SQL apply-047-dashboard-demo-volume.sql no Supabase e tente de novo."
          : seedError
      );
      return;
    }
    setMsg("Base DEMO volumosa carregada. Navegue pelos produtos do dashboard.");
    await load();
  };

  const handleResetDemo = async () => {
    if (!companyId) return;
    if (!confirm("Remover apenas lançamentos DEMO ([DEMO-DASH]) desta empresa?")) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    const { deleted, error: resetError } = await resetDashboardDemo(supabase, companyId);
    setBusy(false);
    if (resetError) {
      setError(resetError);
      return;
    }
    setMsg(`${deleted} lançamento(s) DEMO removido(s).`);
    await load();
  };

  if (!companyId) return <Loading />;

  const plateOptions = [
    { value: "", label: "Todas as placas" },
    ...(snapshot?.filterOptions.plates ?? []).map((p) => ({ value: p, label: p })),
  ];
  const partnerOptions = [
    { value: "", label: "Todos os sócios" },
    ...(snapshot?.filterOptions.partners ?? []).map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ];
  const pctOptions = [
    { value: "", label: "Todas as participações" },
    ...(snapshot?.filterOptions.ownershipPcts ?? []).map((n) => ({
      value: String(n),
      label: `${n}%`,
    })),
  ];

  const showFleetFilters = product === "geral" || product === "frete";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Navegue por produto: visão geral, Frete/Transporte, Estacionamento e Lava-rápido.
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <GlassSelect
              label="Período"
              value={period}
              onChange={(next) => applyPeriodPreset(next as DashboardPeriodKey)}
              options={PERIOD_OPTIONS}
            />
            <label className="block min-w-[9.5rem] space-y-1 text-sm">
              <span className="font-medium text-slate-700">De</span>
              <input
                type="date"
                className={glassField()}
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => applyCustomDate("from", e.target.value)}
              />
            </label>
            <label className="block min-w-[9.5rem] space-y-1 text-sm">
              <span className="font-medium text-slate-700">Até</span>
              <input
                type="date"
                className={glassField()}
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => applyCustomDate("to", e.target.value)}
              />
            </label>
          </div>
          {masterUnlocked ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void handleSeedDemo()}>
                Carregar DEMO
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void handleResetDemo()}
              >
                Limpar DEMO
              </Button>
            </div>
          ) : (
            <p className="max-w-xs text-xs text-slate-500">
              Para carregar/limpar a base DEMO, entre em{" "}
              <Link href="/configuracoes/parametros" className="text-brand-700 underline">
                Senha Máster
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      <DashboardProductNav value={product} onChange={setProduct} />

      {showFleetFilters ? (
        <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${glassFilterPanel()}`}>
          <GlassSelect
            label="Placa"
            value={filters.plate}
            onChange={(plate) => setFilters((f) => ({ ...f, plate }))}
            options={plateOptions}
          />
          <GlassSelect
            label="Sócio"
            value={filters.partnerId}
            onChange={(partnerId) => setFilters((f) => ({ ...f, partnerId }))}
            options={partnerOptions}
          />
          <GlassSelect
            label="Participação"
            value={filters.ownershipPct}
            onChange={(ownershipPct) => setFilters((f) => ({ ...f, ownershipPct }))}
            options={pctOptions}
          />
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={!filters.plate && !filters.partnerId && !filters.ownershipPct}
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Limpar filtros
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="info">{msg}</Alert> : null}
      {snapshot && snapshot.demoRows > 0 ? (
        <Alert variant="warning">
          Este período inclui {snapshot.demoRows} lançamento(s) DEMO. Use “Limpar DEMO” para
          remover só esses registros.
        </Alert>
      ) : null}

      {loading || !snapshot ? (
        <Loading />
      ) : (
        <>
          {product === "geral" ? (
            <div className="space-y-4">
              <KpiStrip snapshot={snapshot} />
              <div className="grid gap-3 lg:grid-cols-3">
                <div className={`space-y-2 ${glassFilterPanel()}`}>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Participação na receita
                  </h2>
                  <div className="rounded-2xl bg-blue-200/90 p-3 ring-1 ring-blue-300/80">
                    <PieChart3D
                      compact
                      slices={[
                        {
                          key: "frete",
                          label: "Frete / Transporte",
                          value: snapshot.frete.revenue,
                          color: PRODUCT_COLORS.frete,
                        },
                        {
                          key: "estac",
                          label: "Estacionamento",
                          value: snapshot.estacionamento.revenue,
                          color: PRODUCT_COLORS.estacionamento,
                        },
                        {
                          key: "lava",
                          label: "Lava-rápido",
                          value: snapshot.lava.revenue,
                          color: PRODUCT_COLORS.lava,
                        },
                      ]}
                    />
                  </div>
                </div>
                <div className={`space-y-2 ${glassFilterPanel()}`}>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Participação nas despesas
                  </h2>
                  <div className="rounded-2xl bg-emerald-50/95 p-3 ring-1 ring-emerald-100/90">
                    <PieChart3D
                      compact
                      slices={[
                        {
                          key: "frete-d",
                          label: "Frete / Transporte",
                          value: snapshot.frete.expense,
                          color: PRODUCT_COLORS.frete,
                        },
                        {
                          key: "estac-d",
                          label: "Estacionamento",
                          value: snapshot.estacionamento.expense,
                          color: PRODUCT_COLORS.estacionamento,
                        },
                        {
                          key: "lava-d",
                          label: "Lava-rápido",
                          value: snapshot.lava.expense,
                          color: PRODUCT_COLORS.lava,
                        },
                      ]}
                    />
                  </div>
                </div>
                <div className={`space-y-2 ${glassFilterPanel()}`}>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Participações societárias
                  </h2>
                  <div className="rounded-2xl bg-indigo-50/90 p-3 ring-1 ring-indigo-100/80">
                    <PieChart3D
                      compact
                      slices={snapshot.participationByPartner.map((p, i) => ({
                        key: p.partnerId,
                        label: p.partnerName,
                        value: Math.max(0, p.result),
                        color: PARTNER_COLORS[i % PARTNER_COLORS.length],
                      }))}
                    />
                  </div>
                </div>
              </div>
              <div className={`overflow-x-auto ${glassFilterPanel()}`}>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">
                  Resumo por produto
                </h3>
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Produto</th>
                      <th className="px-2 py-2">Receita</th>
                      <th className="px-2 py-2">Despesa</th>
                      <th className="px-2 py-2">Resultado</th>
                      <th className="px-2 py-2">% receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["Frete / Transporte", snapshot.frete],
                        ["Estacionamento", snapshot.estacionamento],
                        ["Lava-rápido", snapshot.lava],
                      ] as const
                    ).map(([label, totals]) => {
                      const share =
                        snapshot.kpis.revenue > 0
                          ? (totals.revenue / snapshot.kpis.revenue) * 100
                          : 0;
                      return (
                        <tr key={label} className="border-t border-slate-100">
                          <td className="px-2 py-2 font-medium">{label}</td>
                          <td className="px-2 py-2">{formatCurrency(totals.revenue)}</td>
                          <td className="px-2 py-2">{formatCurrency(totals.expense)}</td>
                          <td className="px-2 py-2 font-medium">
                            {formatCurrency(totals.result)}
                          </td>
                          <td className="px-2 py-2">{share.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <OwnershipBlock snapshot={snapshot} hideChart />
            </div>
          ) : null}

          {product === "frete" ? (
            <div className="space-y-5">
              <div className={glassFilterPanel()}>
                <h2 className="mb-3 text-base font-semibold text-slate-900">
                  Frete / Transporte
                </h2>
                <DashboardModuleCard
                  subtitle="Receita Van/Caminhão e despesas da frota (manhã e tarde)"
                  totals={snapshot.frete}
                  trend={snapshot.freteTrend}
                />
              </div>
              <OwnershipBlock snapshot={snapshot} />
            </div>
          ) : null}

          {product === "estacionamento" ? (
            <div className={glassFilterPanel()}>
              <h2 className="mb-3 text-base font-semibold text-slate-900">Estacionamento</h2>
              <DashboardModuleCard
                subtitle="Receita Estacionamento e custos do pátio"
                totals={snapshot.estacionamento}
                trend={snapshot.estacionamentoTrend}
              />
            </div>
          ) : null}

          {product === "lava" ? (
            <div className={glassFilterPanel()}>
              <h2 className="mb-3 text-base font-semibold text-slate-900">Lava-rápido</h2>
              <DashboardModuleCard
                subtitle="Receita Lava Rápido e materiais"
                totals={snapshot.lava}
                trend={snapshot.lavaTrend}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
