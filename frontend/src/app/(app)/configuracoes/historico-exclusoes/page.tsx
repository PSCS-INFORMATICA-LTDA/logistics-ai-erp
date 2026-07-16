"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useAccess } from "@/lib/access-context";
import { APP_SCREENS } from "@/lib/app-screens";
import { useCompany } from "@/lib/company-context";
import {
  listDeletionAuditEvents,
  type DeletionAuditEvent,
} from "@/lib/deletion-audit";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatDateBR } from "@/lib/utils";

function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function screenLabel(screenKey: string | null): string {
  if (!screenKey) return "—";
  return APP_SCREENS.find((s) => s.key === screenKey)?.label ?? screenKey;
}

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "Todos os tipos" },
  { value: "clients", label: "Clientes" },
  { value: "suppliers", label: "Fornecedores" },
  { value: "vehicles", label: "Veículos" },
  { value: "partners", label: "Sócios" },
  { value: "drivers", label: "Motoristas" },
  { value: "service_orders", label: "Ordens de serviço" },
  { value: "traffic_infractions", label: "Infrações" },
  { value: "financial_transactions", label: "Lançamentos DRE" },
  { value: "vehicle_ownership", label: "Participações" },
  { value: "chart_of_accounts", label: "Contas DRE" },
];

export default function HistoricoExclusoesPage() {
  const { companyId } = useCompany();
  const { isAdmin, loading: accessLoading } = useAccess();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<DeletionAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    setLoading(true);
    setError(null);
    const result = await listDeletionAuditEvents(supabase, companyId, {
      entityType: entityType || null,
      fromDate: fromDate || null,
      toDate: toDate || null,
      limit: 300,
    });
    if (result.error) setError(result.error);
    setRows(result.rows);
    setLoading(false);
  }, [companyId, entityType, fromDate, isAdmin, supabase, toDate]);

  useEffect(() => {
    if (accessLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load();
  }, [accessLoading, isAdmin, load]);

  if (accessLoading || !companyId) return <Loading />;

  if (!isAdmin) {
    return (
      <Alert variant="warning">
        Histórico de exclusões disponível apenas para administradores da empresa.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Histórico de exclusões</h1>
        <p className="mt-1 text-sm text-slate-500">
          Auditoria de quem excluiu registros, com data/hora e resumo do que foi removido.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <section className={`space-y-3 ${glassFilterPanel()}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <GlassSelect
            label="Tipo"
            value={entityType}
            onChange={setEntityType}
            options={ENTITY_TYPE_OPTIONS}
          />
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">De</span>
            <input
              type="date"
              className={glassField(false)}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Até</span>
            <input
              type="date"
              className={glassField(false)}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button type="button" onClick={() => void load()} disabled={loading}>
              Atualizar
            </Button>
          </div>
        </div>
      </section>

      {loading ? <Loading /> : null}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Data / hora</th>
              <th className="px-3 py-2">Usuário</th>
              <th className="px-3 py-2">Tela</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Resumo</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2">Modo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2">{formatOccurredAt(row.occurred_at)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      {row.actor_name || "—"}
                    </div>
                    {row.actor_email ? (
                      <div className="text-xs text-slate-500">{row.actor_email}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{screenLabel(row.screen_key)}</td>
                  <td className="px-3 py-2">{row.entity_type}</td>
                  <td className="px-3 py-2 font-medium">{row.entity_code || "—"}</td>
                  <td className="max-w-xs truncate px-3 py-2" title={row.summary ?? undefined}>
                    {row.summary || "—"}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2" title={row.reason ?? undefined}>
                    {row.reason || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={row.delete_mode === "soft" ? "warning" : "danger"}>
                      {row.delete_mode === "soft" ? "Soft" : "Hard"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {row.payload_json || row.reason ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-brand-700 hover:underline"
                        onClick={() =>
                          setExpandedId((cur) => (cur === row.id ? null : row.id))
                        }
                      >
                        {expandedId === row.id ? "Ocultar" : "Detalhe"}
                      </button>
                    ) : null}
                  </td>
                </tr>
                {expandedId === row.id ? (
                  <tr className="border-t border-slate-50 bg-slate-50/80">
                    <td colSpan={9} className="px-3 py-3">
                      {row.reason ? (
                        <p className="mb-2 text-sm text-slate-800">
                          <span className="font-medium">Motivo:</span> {row.reason}
                        </p>
                      ) : null}
                      {row.payload_json ? (
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-700">
                          {JSON.stringify(row.payload_json, null, 2)}
                        </pre>
                      ) : null}
                      <p className="mt-2 text-xs text-slate-500">
                        ID: {row.entity_id}
                        {row.payload_json &&
                        typeof (row.payload_json as { created_at?: string }).created_at ===
                          "string"
                          ? ` · Criado em ${formatDateBR(
                              (row.payload_json as { created_at: string }).created_at
                            )}`
                          : ""}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                  Nenhuma exclusão registrada ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
