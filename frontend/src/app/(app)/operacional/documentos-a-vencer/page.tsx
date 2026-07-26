"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DriverDocumentsFollowupPanel } from "@/components/compliance/DriverDocumentsFollowupPanel";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useCompany } from "@/lib/company-context";
import {
  documentDisplayName,
  resolveComplianceSituation,
  type ComplianceDocument,
} from "@/lib/compliance-documents";
import {
  listExpiringDocumentsReport,
  listUnreadComplianceAlerts,
  markComplianceAlertRead,
  seedDefaultDocumentTypes,
} from "@/lib/compliance-documents-api";
import { formatExpiryDateBR } from "@/lib/expiry-status";
import { GroupedTableBodies } from "@/components/ui/GroupedTableBodies";
import { groupByKeySorted } from "@/lib/table-row-groups";
import { glassAction, glassFilterPanel, glassTabLink, glassTabsNav } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

type MainTab = "fleet" | "drivers";

export default function DocumentosAVencerOperacionalPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<MainTab>("fleet");
  const [rows, setRows] = useState<ComplianceDocument[]>([]);
  const [vehicles, setVehicles] = useState<
    Map<string, { plate: string; brandModel: string | null }>
  >(new Map());
  const [alerts, setAlerts] = useState<
    Array<{ id: string; title: string; body: string; alert_tier: string; created_at: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "vehicle" | "company">("all");
  const [plateFilter, setPlateFilter] = useState("");
  const [situationFilter, setSituationFilter] = useState<
    "all" | "expiring" | "expired" | "in_renewal" | "suspended"
  >("all");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    await seedDefaultDocumentTypes(supabase, companyId);
    const [rep, al, veh] = await Promise.all([
      listExpiringDocumentsReport(supabase, companyId),
      listUnreadComplianceAlerts(supabase, companyId),
      supabase.from("vehicles").select("id, plate, model").eq("company_id", companyId),
    ]);
    if (rep.error) setError(rep.error);
    setRows(rep.rows);
    setAlerts(al.rows);
    const map = new Map<string, { plate: string; brandModel: string | null }>();
    for (const v of veh.data ?? []) {
      const model = v.model == null || String(v.model).trim() === "" ? null : String(v.model).trim();
      map.set(String(v.id), {
        plate: String(v.plate ?? ""),
        brandModel: model,
      });
    }
    setVehicles(map);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [load, supabase.auth]);

  const filtered = useMemo(() => {
    return rows.filter((doc) => {
      if (scope !== "all" && doc.owner_type !== scope) return false;
      if (plateFilter && doc.owner_type === "vehicle") {
        const plate = vehicles.get(doc.owner_id)?.plate ?? "";
        if (plate !== plateFilter) return false;
      }
      if (plateFilter && doc.owner_type === "company") return false;
      if (situationFilter !== "all") {
        const v = resolveComplianceSituation(doc, doc.document_type);
        if (situationFilter === "expiring" && v.situation !== "expiring_soon") return false;
        if (situationFilter === "expired" && v.situation !== "expired") return false;
        if (situationFilter === "in_renewal" && v.situation !== "in_renewal") return false;
        if (situationFilter === "suspended" && v.situation !== "suspended") return false;
      }
      return true;
    });
  }, [rows, scope, plateFilter, vehicles, situationFilter]);

  const docGroups = useMemo(
    () =>
      groupByKeySorted(
        filtered,
        (doc) => (doc.owner_type === "vehicle" ? doc.owner_id : doc.id),
        (a, b) => documentDisplayName(a.document_type).localeCompare(
          documentDisplayName(b.document_type),
          "pt-BR"
        )
      ),
    [filtered]
  );

  const plateOptions = useMemo(() => {
    const opts = [{ value: "", label: "Todas as placas" }];
    const seen = new Set<string>();
    for (const [id, info] of vehicles) {
      if (!info.plate || seen.has(info.plate)) continue;
      if (rows.some((r) => r.owner_type === "vehicle" && r.owner_id === id)) {
        seen.add(info.plate);
        opts.push({
          value: info.plate,
          label: info.brandModel ? `${info.plate} · ${info.brandModel}` : info.plate,
        });
      }
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [vehicles, rows]);

  if (!companyId || (loading && tab === "fleet")) return <Loading />;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Documentos a vencer</h1>
        <p className="text-sm text-slate-600">
          Acompanhe no Operacional os documentos da frota/empresa e os documentos dos
          motoristas (CNH e CNH-AVC) que precisam ser enviados ou renovados.
        </p>
      </div>

      <nav className={glassTabsNav()} aria-label="Escopo dos documentos">
        <button
          type="button"
          onClick={() => setTab("fleet")}
          className={glassTabLink(tab === "fleet")}
        >
          Frota e empresa
        </button>
        <button
          type="button"
          onClick={() => setTab("drivers")}
          className={glassTabLink(tab === "drivers")}
        >
          Motoristas (CNH / CNH-AVC)
        </button>
      </nav>

      {tab === "drivers" ? (
        <DriverDocumentsFollowupPanel companyId={companyId} />
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Vencimentos por placa (Prefixo, CRLV…) e o TA da empresa. Tipos em{" "}
            <Link href="/configuracoes/documentos-licencas" className={glassAction("sky", true)}>
              Parâmetros → Documentos e licenças
            </Link>
            .
          </p>

          {error ? <Alert variant="error">{error}</Alert> : null}

          <div className={`grid gap-3 sm:grid-cols-3 ${glassFilterPanel()}`}>
            <GlassSelect
              label="Escopo"
              value={scope}
              onChange={(v) => setScope(v as "all" | "vehicle" | "company")}
              options={[
                { value: "all", label: "Todos" },
                { value: "vehicle", label: "Por placa (veículo)" },
                { value: "company", label: "Empresa" },
              ]}
            />
            <GlassSelect
              label="Placa (marca / modelo)"
              value={plateFilter}
              onChange={setPlateFilter}
              options={plateOptions}
            />
            <GlassSelect
              label="Situação"
              value={situationFilter}
              onChange={(v) =>
                setSituationFilter(
                  v as "all" | "expiring" | "expired" | "in_renewal" | "suspended"
                )
              }
              options={[
                { value: "all", label: "Todas" },
                { value: "expiring", label: "A vencer" },
                { value: "expired", label: "Vencidos" },
                { value: "in_renewal", label: "Em renovação" },
                { value: "suspended", label: "Suspenso" },
              ]}
            />
          </div>

          <section className={`space-y-2 ${glassFilterPanel()}`}>
            <h2 className="text-sm font-semibold">Notificações (não lidas)</h2>
            {alerts.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum alerta pendente nesta semana.</p>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-slate-500">{a.body}</p>
                  </div>
                  <button
                    type="button"
                    className={glassAction("sky", true)}
                    onClick={async () => {
                      await markComplianceAlertRead(supabase, companyId, a.id, userId);
                      await load();
                    }}
                  >
                    Marcar lido
                  </button>
                </div>
              ))
            )}
          </section>

          <section className={glassFilterPanel()}>
            <h2 className="mb-2 text-sm font-semibold">Documentos em atenção</h2>
            {filtered.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">
                Nenhum documento vencido ou a vencer neste filtro.
              </p>
            ) : (
              <>
                {/* Mobile: cartão legível por documento. */}
                <ul className="space-y-3 md:hidden">
                  {filtered.map((doc) => {
                    const view = resolveComplianceSituation(doc, doc.document_type);
                    const veh =
                      doc.owner_type === "vehicle" ? vehicles.get(doc.owner_id) : null;
                    const plate =
                      doc.owner_type === "vehicle" ? veh?.plate || "Veículo" : "Empresa";
                    const brandModel =
                      doc.owner_type === "vehicle" ? veh?.brandModel || "—" : "—";
                    return (
                      <li
                        key={doc.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {plate}
                            </p>
                            {brandModel !== "—" ? (
                              <p className="text-sm text-slate-600">{brandModel}</p>
                            ) : null}
                            <p className="mt-1 text-base font-semibold leading-snug break-words text-slate-900">
                              {documentDisplayName(doc.document_type)}
                            </p>
                          </div>
                          <div className="w-fit max-w-full">
                            <Badge variant={view.badge}>{view.label}</Badge>
                          </div>
                        </div>

                        <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
                          <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                            <dt className="text-xs font-medium text-slate-500">Nº</dt>
                            <dd className="break-words text-slate-800">
                              {doc.document_number || "—"}
                            </dd>
                          </div>
                          <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                            <dt className="text-xs font-medium text-slate-500">Validade</dt>
                            <dd className="text-slate-800">
                              {doc.no_expiry
                                ? "Sem vencimento"
                                : formatExpiryDateBR(doc.expires_at) || "—"}
                              {view.daysLeft != null ? ` (${view.daysLeft}d)` : ""}
                              {view.renewalNote || view.situation === "suspended" ? (
                                <span className="block text-xs text-slate-500">
                                  Validade original mantida
                                </span>
                              ) : null}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>

                {/* Desktop: tabela agrupada por placa. */}
                <div className="hidden md:block">
                  <DataTableScroll stickyFirst>
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5">Placa / Escopo</th>
                          <th className="px-3 py-2.5">Marca / modelo</th>
                          <th className="px-3 py-2.5">Documento</th>
                          <th className="px-3 py-2.5">Nº</th>
                          <th className="px-3 py-2.5">Validade</th>
                          <th className="px-3 py-2.5">Situação</th>
                        </tr>
                      </thead>
                      <GroupedTableBodies groups={docGroups} colSpan={6}>
                        {(group) =>
                          group.rows.map((doc, index) => {
                            const view = resolveComplianceSituation(doc, doc.document_type);
                            const veh =
                              doc.owner_type === "vehicle" ? vehicles.get(doc.owner_id) : null;
                            const plate =
                              doc.owner_type === "vehicle" ? veh?.plate || "Veículo" : "Empresa";
                            const brandModel =
                              doc.owner_type === "vehicle" ? veh?.brandModel || "—" : "—";
                            return (
                              <tr
                                key={doc.id}
                                className={group.multi ? "align-top" : "border-t border-slate-100"}
                              >
                                <td className="whitespace-nowrap px-3 py-3 font-medium">
                                  {index === 0 ? (
                                    plate
                                  ) : group.multi ? (
                                    <span className="text-slate-300" aria-hidden>
                                      ↳
                                    </span>
                                  ) : (
                                    plate
                                  )}
                                </td>
                                <td className="px-3 py-3 text-slate-700">
                                  {index === 0 || !group.multi ? brandModel : ""}
                                </td>
                                <td className="px-3 py-3">
                                  {documentDisplayName(doc.document_type)}
                                </td>
                                <td className="px-3 py-3">{doc.document_number || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-3">
                                  {doc.no_expiry
                                    ? "Sem vencimento"
                                    : formatExpiryDateBR(doc.expires_at) || "—"}
                                  {view.daysLeft != null ? ` (${view.daysLeft}d)` : ""}
                                  {view.renewalNote || view.situation === "suspended" ? (
                                    <span className="block text-xs text-slate-500">
                                      Validade original mantida
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-3">
                                  <Badge variant={view.badge}>{view.label}</Badge>
                                </td>
                              </tr>
                            );
                          })
                        }
                      </GroupedTableBodies>
                    </table>
                  </DataTableScroll>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
