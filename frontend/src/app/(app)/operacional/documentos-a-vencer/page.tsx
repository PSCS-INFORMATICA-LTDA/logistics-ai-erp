"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
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
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

export default function DocumentosAVencerOperacionalPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
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
      return true;
    });
  }, [rows, scope, plateFilter, vehicles]);

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

  if (!companyId || loading) return <Loading />;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Documentos a vencer</h1>
        <p className="text-sm text-slate-600">
          Acompanhe vencimentos por placa (Prefixo, CRLV…) e o TA da empresa. Tipos em{" "}
          <Link href="/configuracoes/documentos-licencas" className="text-sky-700 underline">
            Parâmetros → Documentos e licenças
          </Link>
          .
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className={`grid gap-3 sm:grid-cols-2 ${glassFilterPanel()}`}>
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
                className="text-xs font-medium text-sky-700 underline"
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

      <section className={`overflow-x-auto ${glassFilterPanel()}`}>
        <h2 className="mb-2 text-sm font-semibold">Documentos em atenção</h2>
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Placa / Escopo</th>
              <th className="px-2 py-2">Marca / modelo</th>
              <th className="px-2 py-2">Documento</th>
              <th className="px-2 py-2">Nº</th>
              <th className="px-2 py-2">Validade</th>
              <th className="px-2 py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-slate-500">
                  Nenhum documento vencido ou a vencer neste filtro.
                </td>
              </tr>
            ) : (
              filtered.map((doc) => {
                const view = resolveComplianceSituation(doc, doc.document_type);
                const veh =
                  doc.owner_type === "vehicle" ? vehicles.get(doc.owner_id) : null;
                const plate =
                  doc.owner_type === "vehicle" ? veh?.plate || "Veículo" : "Empresa";
                const brandModel =
                  doc.owner_type === "vehicle" ? veh?.brandModel || "—" : "—";
                return (
                  <tr key={doc.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-medium">{plate}</td>
                    <td className="px-2 py-2 text-slate-700">{brandModel}</td>
                    <td className="px-2 py-2">
                      {documentDisplayName(doc.document_type)}
                    </td>
                    <td className="px-2 py-2">{doc.document_number || "—"}</td>
                    <td className="px-2 py-2">
                      {doc.no_expiry ? "—" : formatExpiryDateBR(doc.expires_at)}
                      {view.daysLeft != null ? ` (${view.daysLeft}d)` : ""}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={view.badge}>{view.label}</Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
