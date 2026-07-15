"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DashboardModuleCard } from "@/components/dashboard/DashboardModuleCard";
import { PieChart3D } from "@/components/dashboard/PieChart3D";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useCompany } from "@/lib/company-context";
import {
  fetchDashboardSnapshot,
  resetDashboardDemo,
  seedDashboardDemo,
} from "@/lib/dashboard-api";
import type { DashboardPeriodKey, DashboardSnapshot } from "@/lib/dashboard-metrics";
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

const PERIOD_OPTIONS: { value: DashboardPeriodKey; label: string }[] = [
  { value: "current_month", label: "Mês atual" },
  { value: "previous_month", label: "Mês anterior" },
  { value: "last_3_months", label: "Últimos 3 meses" },
];

export default function DashboardPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [period, setPeriod] = useState<DashboardPeriodKey>("current_month");
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
      period
    );
    if (loadError) setError(loadError);
    setSnapshot(next);
    setLoading(false);
  }, [companyId, period, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSeedDemo = async () => {
    if (!companyId) return;
    if (
      !confirm(
        "Carregar base DEMO na empresa atual? Os lançamentos ficam marcados [DEMO-DASH] e poderão ser removidos depois. A limpeza total do sistema será em outro update."
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
          ? "Execute o SQL apply-046-dashboard-demo-seed.sql no Supabase e tente de novo."
          : seedError
      );
      return;
    }
    setMsg("Base DEMO carregada. Gráficos atualizados.");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Receitas e despesas em 3D — Frete/Transporte, Estacionamento, Lava-rápido e
            participações societárias.
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

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="info">{msg}</Alert> : null}
      {snapshot && snapshot.demoRows > 0 ? (
        <Alert variant="warning">
          Este período inclui {snapshot.demoRows} lançamento(s) DEMO. Limpeza total do sistema
          fica para um update futuro; use “Limpar DEMO” para remover só esses registros.
        </Alert>
      ) : null}

      {loading || !snapshot ? (
        <Loading />
      ) : (
        <>
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
              <div key={kpi.label} className={glassFilterPanel()}>
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

          <div className="grid gap-4 xl:grid-cols-3">
            <DashboardModuleCard
              title="Frete / Transporte"
              subtitle="Receita Caminhão/Van e despesas da frota"
              totals={snapshot.frete}
              trend={snapshot.trend}
            />
            <DashboardModuleCard
              title="Estacionamento"
              subtitle="Receita Estacionamento e custos do pátio"
              totals={snapshot.estacionamento}
              trend={snapshot.trend}
            />
            <DashboardModuleCard
              title="Lava-rápido"
              subtitle="Receita Lava Rápido e materiais/comissões"
              totals={snapshot.lava}
              trend={snapshot.trend}
            />
          </div>

          <section className={`space-y-4 ${glassFilterPanel()}`}>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Participações societárias
              </h2>
              <p className="text-xs text-slate-500">
                Rateio do resultado por placa × % (100% GRX, 100% Rafael, compartilhados…).
              </p>
            </div>
            <PieChart3D
              slices={snapshot.participationByPartner.map((p) => ({
                key: p.partnerId,
                label: p.partnerName,
                value: Math.max(0, p.result),
              }))}
            />
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
                    <tr key={`${row.partnerId}-${row.plate}`} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-medium">
                        {row.partnerName}
                        {row.isFullOwner ? (
                          <span className="ml-2 inline-block">
                            <Badge variant="success">100%</Badge>
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
                        Sem participações ativas ou sem lançamentos com veículo de rateio.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { title: "Sócios", href: "/cadastros/socios", desc: "Cadastro societário" },
          { title: "Participações", href: "/cadastros/participacoes", desc: "% por placa" },
          { title: "DRE empresa", href: "/dre/lancamentos", desc: "Lançamentos" },
          { title: "Estacionamento", href: "/operacional/estacionamento", desc: "Ordens do pátio" },
          { title: "Lava-rápido", href: "/operacional/lava-rapido", desc: "Serviços" },
          {
            title: "OS transporte e frete",
            href: "/operacional/ordens-servico",
            desc: "Operação",
          },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader title={item.title} description={item.desc} />
              <CardBody>
                <span className="text-sm font-medium text-brand-600">Abrir →</span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
