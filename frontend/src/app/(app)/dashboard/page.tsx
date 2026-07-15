"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DashboardModuleCard } from "@/components/dashboard/DashboardModuleCard";
import { DashboardSection } from "@/components/dashboard/DashboardSection";
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
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

const PERIOD_OPTIONS: { value: DashboardPeriodKey; label: string }[] = [
  { value: "last_4_months", label: "Últimos 4 meses" },
  { value: "last_3_months", label: "Últimos 3 meses" },
  { value: "current_month", label: "Mês atual" },
  { value: "previous_month", label: "Mês anterior" },
];

const EMPTY_FILTERS: DashboardFilters = {
  plate: "",
  partnerId: "",
  ownershipPct: "",
};

export default function DashboardPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [period, setPeriod] = useState<DashboardPeriodKey>("last_4_months");
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const masterUnlocked = companyId ? isMasterSessionUnlocked(companyId) : false;

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const { snapshot: next, error: loadError } = await fetchDashboardSnapshot(
      supabase,
      companyId,
      period,
      filters
    );
    if (loadError) setError(loadError);
    setSnapshot(next);
    setLoading(false);
  }, [companyId, period, filters, supabase]);

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
    setMsg("Base DEMO volumosa carregada. Use os filtros por placa, sócio e participação.");
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Acompanhamento de Frete/Transporte, Estacionamento, Lava-rápido e rateio por
            participação.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <GlassSelect
            label="Período"
            value={period}
            onChange={(next) => setPeriod(next as DashboardPeriodKey)}
            options={PERIOD_OPTIONS}
          />
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
            disabled={
              !filters.plate && !filters.partnerId && !filters.ownershipPct
            }
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Limpar filtros
          </Button>
        </div>
      </div>

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
          <DashboardSection
            id="dash-visao-geral"
            title="Visão geral"
            subtitle={`${snapshot.from} → ${snapshot.to}`}
          >
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
                <div key={kpi.label} className="rounded-xl bg-white/50 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {kpi.label}
                  </p>
                  <p className={`mt-1 text-xl font-bold tabular-nums ${kpi.tone}`}>
                    {"isPct" in kpi && kpi.isPct
                      ? `${kpi.value.toFixed(1)}%`
                      : formatCurrency(kpi.value)}
                  </p>
                </div>
              ))}
            </div>
          </DashboardSection>

          <DashboardSection
            id="dash-frete"
            title="Frete / Transporte"
            subtitle="Receita Van/Caminhão e despesas da frota (manhã e tarde)"
          >
            <DashboardModuleCard totals={snapshot.frete} trend={snapshot.freteTrend} />
          </DashboardSection>

          <DashboardSection
            id="dash-estacionamento"
            title="Estacionamento"
            subtitle="Receita Estacionamento e custos do pátio"
          >
            <DashboardModuleCard
              totals={snapshot.estacionamento}
              trend={snapshot.estacionamentoTrend}
            />
          </DashboardSection>

          <DashboardSection
            id="dash-lava"
            title="Lava-rápido"
            subtitle="Receita Lava Rápido e materiais"
          >
            <DashboardModuleCard totals={snapshot.lava} trend={snapshot.lavaTrend} />
          </DashboardSection>

          <DashboardSection
            id="dash-participacoes"
            title="Participações societárias"
            subtitle="Rateio por placa × % — filtre 50% ou 100% para comparar grupos"
          >
            <PieChart3D
              slices={snapshot.participationByPartner.map((p) => ({
                key: p.partnerId,
                label: p.partnerName,
                value: Math.max(0, p.result),
              }))}
            />
            <div className="mt-4 overflow-x-auto">
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
                      <td className="px-2 py-2 font-medium">
                        {formatCurrency(row.result)}
                      </td>
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
          </DashboardSection>
        </>
      )}
    </div>
  );
}
