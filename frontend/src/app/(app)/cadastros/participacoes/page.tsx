"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { recordDeletion, summarizeDeletedRow } from "@/lib/deletion-audit";
import { importOwnershipFromSpreadsheet, OWNERSHIP_SEED } from "@/lib/import-ownership";
import { createClient } from "@/lib/supabase/client";
import {
  fromDbOwnershipRow,
  getOwnershipDbSchema,
  ownershipOrderColumn,
  toDbOwnershipPayload,
} from "@/lib/vehicle-ownership-db";
import type { Partner, Vehicle, VehicleOwnership } from "@/types/database";
import { OWNERSHIP_STATUS_OPTIONS } from "@/types/database";

function ImportOwnershipButton({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const supabase = createClient();

  const handleImport = async () => {
    if (!companyId) return;
    if (
      !confirm(
        `Importar ${OWNERSHIP_SEED.length} participações da planilha Participacao_Veiculo?\n\n` +
          "Placas: SWU9H17, TLS6D65, GHR2C77\n" +
          "(SUY3I05 não possui linha na aba da planilha.)"
      )
    ) {
      return;
    }

    setLoading(true);
    setMsg(null);
    setDetail(null);

    try {
      const result = await importOwnershipFromSpreadsheet(companyId, supabase);
      const lines = [
        `${result.imported} participação(ões) importada(s).`,
        result.partnersCreated > 0 ? `${result.partnersCreated} sócio(s) criado(s) da planilha.` : null,
        result.vehiclesCreated > 0 ? `${result.vehiclesCreated} veículo(s) criado(s) da planilha.` : null,
        result.operationalUpdated > 0
          ? `${result.operationalUpdated} responsável(is) operacional(is) atualizado(s).`
          : null,
        result.skipped > 0 ? `${result.skipped} ignorada(s).` : null,
        ...result.warnings,
        ...result.errors,
      ].filter(Boolean);

      if (result.imported > 0) {
        setMsg("Importação concluída.");
        onDone();
      } else {
        setMsg("Importação não realizada.");
      }
      setDetail(lines.join(" "));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erro na importação.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={handleImport} disabled={loading}>
        {loading ? "Importando..." : "Importar da planilha"}
      </Button>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {detail && <p className="text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

export default function ParticipacoesPage() {
  const { companyId, loading: companyLoading } = useCompany();
  const { canEditScreen, canDeleteScreen } = useAccess();
  const canEdit = canEditScreen("cadastros.participacoes");
  const canDelete = canDeleteScreen("cadastros.participacoes");
  const supabase = createClient();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [items, setItems] = useState<VehicleOwnership[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<VehicleOwnership> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  const partnerMap = useMemo(
    () => new Map(partners.map((p) => [p.id, p.name])),
    [partners]
  );

  const activeTotal = useMemo(
    () =>
      items
        .filter((i) => i.status === "Ativo")
        .reduce((sum, i) => sum + Number(i.ownership_percentage), 0),
    [items]
  );

  const loadLookups = useCallback(async () => {
    if (!companyId) return;

    const [vehiclesRes, partnersRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("*")
        .eq("company_id", companyId)
        .eq("status", "Ativo")
        .is("deleted_at", null)
        .order("plate"),
      supabase
        .from("partners")
        .select("*")
        .eq("company_id", companyId)
        .eq("status", "Ativo")
        .eq("use_in_allocation", true)
        .is("deleted_at", null)
        .order("name"),
    ]);

    setVehicles((vehiclesRes.data as Vehicle[]) ?? []);
    setPartners((partnersRes.data as Partner[]) ?? []);
  }, [companyId, supabase]);

  const loadOwnerships = useCallback(async () => {
    if (!companyId || !selectedVehicleId) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    const schema = await getOwnershipDbSchema(supabase);

    const { data, error: err } = await supabase
      .from("vehicle_ownership")
      .select("*")
      .eq("company_id", companyId)
      .eq("vehicle_id", selectedVehicleId)
      .order(ownershipOrderColumn(schema), { ascending: false });

    if (err) {
      setError(err.message);
      setItems([]);
    } else {
      setItems(((data as Record<string, unknown>[]) ?? []).map((row) => fromDbOwnershipRow(row, schema)));
    }

    setLoading(false);
  }, [companyId, selectedVehicleId, supabase]);

  useEffect(() => {
    if (companyId) loadLookups();
  }, [companyId, loadLookups]);

  useEffect(() => {
    loadOwnerships();
    setEditing(null);
    setIsNew(false);
  }, [loadOwnerships]);

  const validateTotal = (data: Record<string, unknown>, excludeId?: string) => {
    const percentage = Number(data.ownership_percentage);
    const status = String(data.status ?? "Ativo");

    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      return "Percentual deve estar entre 0,01 e 100,00.";
    }

    if (status !== "Ativo") return null;

    const total = items
      .filter((i) => i.status === "Ativo" && i.id !== excludeId)
      .reduce((sum, i) => sum + Number(i.ownership_percentage), 0);

    if (total + percentage > 100) {
      return `Soma das participações ativas excede 100% (atual: ${formatPercent(total)}, novo: ${formatPercent(percentage)}).`;
    }

    return null;
  };

  const handleSave = async (data: Record<string, unknown>) => {
    if (!companyId || !selectedVehicleId) return;
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração.");
      return;
    }

    const validationError = validateTotal(data, editing?.id);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    const schema = await getOwnershipDbSchema(supabase);

    const payload = toDbOwnershipPayload(
      {
        company_id: companyId,
        vehicle_id: selectedVehicleId,
        partner_id: data.partner_id,
        ownership_percentage: Number(data.ownership_percentage),
        effective_date: data.effective_date || todayIso(),
        end_date: data.end_date ? data.end_date : null,
        status: data.status ?? "Ativo",
      },
      schema
    );

    const { error: err } = editing?.id
      ? await supabase.from("vehicle_ownership").update(payload).eq("id", editing.id)
      : await supabase.from("vehicle_ownership").insert(payload);

    setSaving(false);

    if (err) {
      setError(err.message);
      return;
    }

    setEditing(null);
    setIsNew(false);
    await loadOwnerships();
  };

  const handleClose = async (id: string) => {
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração.");
      return;
    }
    if (!confirm("Encerrar esta participação societária?")) return;

    const { error: err } = await supabase
      .from("vehicle_ownership")
      .update({ status: "Encerrado", end_date: todayIso() })
      .eq("id", id);

    if (err) setError(err.message);
    else await loadOwnerships();
  };

  const requestDelete = (id: string) => {
    if (!canDelete) {
      setError("Seu acesso não inclui Exclusão nesta tela.");
      return;
    }
    setPendingDeleteId(id);
  };

  const handleDelete = async (reason: string) => {
    if (!canDelete) {
      setError("Seu acesso não inclui Exclusão nesta tela.");
      setPendingDeleteId(null);
      return;
    }
    if (!companyId || !pendingDeleteId) return;

    const id = pendingDeleteId;
    setDeleting(true);
    setError(null);

    const existing = items.find((row) => row.id === id) as
      | (VehicleOwnership & Record<string, unknown>)
      | undefined;
    if (existing) {
      const row = existing as unknown as Record<string, unknown>;
      const { entityCode, summary } = summarizeDeletedRow(row, "vehicle_ownership");
      await recordDeletion({
        supabase,
        companyId,
        entityType: "vehicle_ownership",
        entityId: id,
        entityCode,
        summary: summary || `Participação ${id.slice(0, 8)}`,
        reason,
        screenKey: "cadastros.participacoes",
        deleteMode: "hard",
        payload: row,
      });
    }

    const { error: err } = await supabase.from("vehicle_ownership").delete().eq("id", id);
    setDeleting(false);
    setPendingDeleteId(null);
    if (err) setError(err.message);
    else await loadOwnerships();
  };

  const distributionVariant =
    activeTotal > 100 ? "danger" : activeTotal === 100 ? "success" : "warning";

  if (companyLoading) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Participação Societária</h1>
          <p className="mt-1 text-sm text-slate-500">
            Percentual de participação por veículo — base para rateio financeiro
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {canEdit ? (
          <ImportOwnershipButton
            onDone={() => {
              loadLookups();
              loadOwnerships();
            }}
          />
          ) : null}
          {canEdit && selectedVehicleId && !isNew && !editing && (
            <Button onClick={() => { setIsNew(true); setEditing({}); }}>
              + Adicionar sócio
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardBody>
          <label className="block max-w-md space-y-1">
            <span className="text-sm font-medium text-slate-700">Veículo</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
            >
              <option value="">Selecione um veículo...</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate_display ?? v.plate}
                  {v.model ? ` — ${v.model}` : ""}
                </option>
              ))}
            </select>
          </label>
        </CardBody>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {!selectedVehicleId ? (
        <Card>
          <CardBody>
            <p className="py-6 text-center text-sm text-slate-500">
              Selecione um veículo para gerenciar as participações societárias.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={selectedVehicle?.plate_display ?? selectedVehicle?.plate ?? "Veículo"}
              description="Distribuição de participação entre sócios"
            />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Total ativo</span>
                <Badge variant={distributionVariant}>{formatPercent(activeTotal)}</Badge>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    activeTotal > 100
                      ? "bg-red-500"
                      : activeTotal === 100
                        ? "bg-emerald-500"
                        : "bg-amber-400"
                  }`}
                  style={{ width: `${Math.min(activeTotal, 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {activeTotal === 100
                  ? "Distribuição completa (100%)."
                  : activeTotal > 100
                    ? "A soma excede 100% — ajuste as participações ativas."
                    : `Faltam ${formatPercent(100 - activeTotal)} para completar 100%.`}
              </p>
            </CardBody>
          </Card>

          {!canEdit ? (
            <Alert variant="info">
              Modo visualização: você pode consultar as participações, mas não alterar.
            </Alert>
          ) : null}

          {canEdit && (isNew || editing) && (
            <Card>
              <CardHeader title={editing?.id ? "Editar participação" : "Nova participação"} />
              <CardBody>
                <EntityForm
                  saving={saving}
                  onCancel={() => { setEditing(null); setIsNew(false); setError(null); }}
                  initial={{
                    partner_id: editing?.partner_id ?? "",
                    ownership_percentage: editing?.ownership_percentage ?? "",
                    effective_date: editing?.effective_date ?? todayIso(),
                    end_date: editing?.end_date ?? "",
                    status: editing?.status ?? "Ativo",
                  }}
                  onSubmit={handleSave}
                >
                  {({ form, set }) => (
                    <FormFields
                      form={form}
                      set={set}
                      fields={[
                        {
                          name: "partner_id",
                          label: "Sócio",
                          type: "select",
                          required: true,
                          options: [
                            { value: "", label: "Selecione..." },
                            ...partners
                              .filter((p) => editing?.id || !items.some(
                                (i) => i.partner_id === p.id && i.status === "Ativo" && i.id !== editing?.id
                              ))
                              .map((p) => ({
                                value: p.id,
                                label: `${p.name} (${p.code})`,
                              })),
                          ],
                        },
                        {
                          name: "ownership_percentage",
                          label: "Percentual (%)",
                          type: "number",
                          required: true,
                        },
                        {
                          name: "effective_date",
                          label: "Data de início",
                          type: "date",
                          required: true,
                        },
                        { name: "end_date", label: "Data de fim", type: "date" },
                        {
                          name: "status",
                          label: "Status",
                          type: "select",
                          options: OWNERSHIP_STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
                        },
                      ]}
                    />
                  )}
                </EntityForm>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody className="overflow-x-auto p-0">
              {loading ? (
                <Loading />
              ) : items.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-slate-500">
                  Nenhuma participação cadastrada para este veículo.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left">
                      <th className="px-4 py-3 font-medium text-slate-600">Sócio</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Percentual</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Início</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Fim</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-slate-700">
                          {partnerMap.get(row.partner_id) ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">
                          {formatPercent(Number(row.ownership_percentage))}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatDate(row.effective_date)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{formatDate(row.end_date)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={row.status === "Ativo" ? "success" : "default"}>
                            {row.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {canEdit || canDelete ? (
                          <div className="flex gap-2">
                            {canEdit ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setEditing(row); setIsNew(false); setError(null); }}
                            >
                              Editar
                            </Button>
                            ) : null}
                            {canEdit && row.status === "Ativo" ? (
                              <Button variant="ghost" size="sm" onClick={() => handleClose(row.id)}>
                                Encerrar
                              </Button>
                            ) : null}
                            {canDelete ? (
                            <Button variant="ghost" size="sm" onClick={() => requestDelete(row.id)}>
                              Excluir
                            </Button>
                            ) : null}
                          </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <DeleteReasonModal
        open={Boolean(pendingDeleteId)}
        confirming={deleting}
        title="Excluir participação"
        description="Informe o motivo da exclusão permanente desta participação societária."
        onCancel={() => {
          if (!deleting) setPendingDeleteId(null);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
