"use client";

import { useCallback, useEffect, useState } from "react";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import {
  InfractionAlertsCell,
  InfractionAlertsSummary,
  InfractionListFilters,
} from "@/components/infractions/InfractionAlerts";
import { InfractionPaymentProofSection } from "@/components/infractions/InfractionPaymentProofSection";
import { Badge, Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { nextCode } from "@/lib/codes";
import { useCompany } from "@/lib/company-context";
import {
  getAuthorityStatusLabel,
  getCaseStatusLabel,
  getInfractionAlerts,
  getPaymentProofStatusLabel,
  alertLevelToBadgeVariant,
  INFRACTION_ALERT_FOOTNOTES,
  matchesInfractionFilter,
  type InfractionPendingFilter,
} from "@/lib/infraction-alerts";
import {
  suggestDriverForInfraction,
  type InfractionDriverSuggestion,
} from "@/lib/infraction-driver-suggest";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, normalizePlate } from "@/lib/utils";
import type { Driver, TrafficInfraction, Vehicle } from "@/types/database";
import {
  INFRACTION_ASSIGNMENT_STATUS,
  INFRACTION_AUTHORITY_STATUS,
  INFRACTION_CASE_STATUS,
  INFRACTION_PAYMENT_PROOF_STATUS,
} from "@/types/database";

type InfractionRow = TrafficInfraction & {
  vehicle_plate?: string;
  driver_name?: string;
  service_order_code?: string;
};


function authorityVariant(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "Aceito") return "success";
  if (status === "Indicado") return "warning";
  if (status === "Recusado") return "danger";
  return "default";
}

function paymentVariant(status: string): "success" | "warning" | "default" {
  if (status === "Validado") return "success";
  if (status === "Apresentado") return "warning";
  return "default";
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  service_order: "Ordem de serviço",
  financial_transaction: "Lançamento financeiro",
};

export default function InfracoesPage() {
  const { companyId } = useCompany();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [listRows, setListRows] = useState<InfractionRow[]>([]);
  const [alertFilter, setAlertFilter] = useState<InfractionPendingFilter>("pending_any");
  const supabase = createClient();

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      supabase
        .from("drivers")
        .select("id, code, name")
        .eq("company_id", companyId)
        .eq("status", "Ativo")
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("vehicles")
        .select("id, code, plate, plate_display, model")
        .eq("company_id", companyId)
        .eq("status", "Ativo")
        .is("deleted_at", null)
        .order("plate"),
    ]).then(([driversRes, vehiclesRes]) => {
      setDrivers((driversRes.data as Driver[]) ?? []);
      setVehicles((vehiclesRes.data as Vehicle[]) ?? []);
    });
  }, [companyId, supabase]);

  const transformItems = useCallback(
    async (items: InfractionRow[]) => {
      const driverIds = [...new Set(items.map((i) => i.driver_id).filter(Boolean))] as string[];
      const vehicleIds = [...new Set(items.map((i) => i.vehicle_id).filter(Boolean))] as string[];
      const orderIds = [...new Set(items.map((i) => i.service_order_id).filter(Boolean))] as string[];

      const [driversRes, vehiclesRes, ordersRes] = await Promise.all([
        driverIds.length
          ? supabase.from("drivers").select("id, name").in("id", driverIds)
          : Promise.resolve({ data: [] }),
        supabase.from("vehicles").select("id, plate, plate_display").in("id", vehicleIds),
        orderIds.length
          ? supabase.from("service_orders").select("id, code").in("id", orderIds)
          : Promise.resolve({ data: [] }),
      ]);

      const driverMap = new Map((driversRes.data ?? []).map((d) => [d.id, d.name as string]));
      const vehicleMap = new Map(
        (vehiclesRes.data ?? []).map((v) => [v.id, (v.plate_display ?? v.plate) as string])
      );
      const orderMap = new Map((ordersRes.data ?? []).map((o) => [o.id, o.code as string]));

      const enriched = items.map((item) => ({
        ...item,
        driver_name: item.driver_id ? driverMap.get(item.driver_id) : undefined,
        vehicle_plate: item.plate ?? vehicleMap.get(item.vehicle_id),
        service_order_code: item.service_order_id
          ? orderMap.get(item.service_order_id)
          : undefined,
        authority_status: item.authority_status ?? "Pendente",
        payment_proof_status: item.payment_proof_status ?? "Pendente",
        case_status: item.case_status ?? "EmAndamento",
      }));

      setListRows(enriched);
      return enriched;
    },
    [supabase]
  );

  const vehicleOptions = vehicles.map((v) => ({
    value: v.id,
    label: `${v.plate_display ?? v.plate} — ${v.model ?? v.code}`,
    plate: v.plate_display ?? v.plate,
  }));

  const driverOptions = [
    { value: "", label: "— Pendente atribuição —" },
    ...drivers.map((d) => ({ value: d.id, label: d.name })),
  ];

  const visibleCount = listRows.filter((row) => matchesInfractionFilter(row, alertFilter)).length;

  return (
    <CrudPage<InfractionRow>
      title="Infrações de Trânsito"
      description="Acompanhe indicação ao órgão autuador, comprovante de pagamento, baixa e arquivamento"
      table="traffic_infractions"
      orderBy="infraction_date"
      softDelete={false}
      transformItems={transformItems}
      filterItem={(row) => matchesInfractionFilter(row, alertFilter)}
      toolbar={
        <div className="space-y-4">
          <InfractionAlertsSummary
            rows={listRows}
            activeFilter={alertFilter}
            onFilterChange={setAlertFilter}
          />
          <InfractionListFilters
            filter={alertFilter}
            totalCount={listRows.length}
            visibleCount={visibleCount}
            onFilterChange={setAlertFilter}
          />
        </div>
      }
      columns={[
        { key: "code", label: "Código" },
        { key: "infraction_date", label: "Data" },
        {
          key: "vehicle_plate",
          label: "Placa",
          render: (r) => r.vehicle_plate ?? "—",
        },
        {
          key: "driver_name",
          label: "Responsável",
          render: (r) => r.driver_name ?? "—",
        },
        {
          key: "authority_status",
          label: "Órgão autuador",
          render: (r) => (
            <Badge variant={authorityVariant(r.authority_status ?? "Pendente")}>
              {getAuthorityStatusLabel(r.authority_status ?? "Pendente")}
            </Badge>
          ),
        },
        {
          key: "payment_proof_status",
          label: "Comprovante",
          render: (r) => (
            <Badge variant={paymentVariant(r.payment_proof_status ?? "Pendente")}>
              {getPaymentProofStatusLabel(r.payment_proof_status ?? "Pendente")}
            </Badge>
          ),
        },
        {
          key: "alerts",
          label: "Alertas",
          render: (r) => <InfractionAlertsCell row={r} />,
        },
        {
          key: "case_status",
          label: "Processo",
          render: (r) => getCaseStatusLabel(r.case_status ?? "EmAndamento"),
        },
        {
          key: "amount",
          label: "Valor",
          render: (r) => (r.amount != null ? formatCurrency(r.amount) : "—"),
        },
      ]}
      renderForm={({ item, onSave, onCancel, saving }) => (
        <InfractionForm
          item={item}
          companyId={companyId}
          saving={saving}
          onCancel={onCancel}
          onSave={onSave}
          vehicleOptions={vehicleOptions}
          driverOptions={driverOptions}
        />
      )}
    />
  );
}

function InfractionForm({
  item,
  companyId,
  saving,
  onCancel,
  onSave,
  vehicleOptions,
  driverOptions,
}: {
  item: Partial<InfractionRow> | null;
  companyId: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (data: Record<string, unknown>) => Promise<string | null>;
  vehicleOptions: { value: string; label: string; plate: string }[];
  driverOptions: { value: string; label: string }[];
}) {
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<InfractionDriverSuggestion | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(item?.id ?? null);

  useEffect(() => {
    setSavedId(item?.id ?? null);
  }, [item?.id]);

  return (
    <EntityForm
      saving={saving}
      onCancel={onCancel}
      initial={{
        code: item?.code ?? "",
        vehicle_id: item?.vehicle_id ?? "",
        plate: item?.plate ?? "",
        infraction_date: item?.infraction_date ?? new Date().toISOString().slice(0, 10),
        ait_number: item?.ait_number ?? "",
        description: item?.description ?? "",
        amount: item?.amount ?? "",
        points: item?.points ?? "",
        driver_id: item?.driver_id ?? "",
        service_order_id: item?.service_order_id ?? "",
        assignment_source: item?.assignment_source ?? "",
        assignment_status: item?.assignment_status ?? "Pendente",
        authority_status: item?.authority_status ?? "Pendente",
        authority_indicated_at: item?.authority_indicated_at ?? "",
        authority_responded_at: item?.authority_responded_at ?? "",
        payment_proof_status: item?.payment_proof_status ?? "Pendente",
        payment_proof_received_at: item?.payment_proof_received_at ?? "",
        payment_validated_at: item?.payment_validated_at ?? "",
        case_status: item?.case_status ?? "EmAndamento",
        notes: item?.notes ?? "",
      }}
      onSubmit={async (data) => {
        if (!item?.id && companyId && !data.code) {
          data.code = await nextCode("traffic_infractions", companyId, "INF");
        }
        if (data.amount === "") data.amount = null;
        if (data.points === "") data.points = null;
        for (const key of [
          "driver_id",
          "service_order_id",
          "ait_number",
          "description",
          "assignment_source",
          "authority_indicated_at",
          "authority_responded_at",
          "payment_proof_received_at",
          "payment_validated_at",
          "notes",
        ]) {
          if (data[key] === "") data[key] = null;
        }
        if (data.driver_id && !data.assignment_source) {
          data.assignment_source = "manual";
        }
        if (!data.vehicle_id) {
          window.alert("Selecione um veículo cadastrado na frota.");
          return;
        }
        const selectedVehicle = vehicleOptions.find((v) => v.value === data.vehicle_id);
        if (!selectedVehicle) {
          window.alert("Veículo inválido — cadastre a placa em Cadastros → Veículos.");
          return;
        }
        data.plate = normalizePlate(selectedVehicle.plate);
        if (data.authority_status === "Indicado" && !data.authority_indicated_at) {
          data.authority_indicated_at = new Date().toISOString().slice(0, 10);
        }
        if (
          (data.authority_status === "Aceito" || data.authority_status === "Recusado") &&
          !data.authority_responded_at
        ) {
          data.authority_responded_at = new Date().toISOString().slice(0, 10);
        }
        const id = await onSave(data);
        if (id) setSavedId(id);
      }}
    >
      {({ form, set }) => {
        const alertPreview = getInfractionAlerts({
          driver_id: (form.driver_id as string) || null,
          assignment_status: String(form.assignment_status),
          authority_status: String(form.authority_status),
          payment_proof_status: String(form.payment_proof_status),
          case_status: String(form.case_status),
        });

        return (
          <div className="space-y-6">
            {alertPreview.length > 0 && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-700">Alertas do processo</p>
                <div className="space-y-2">
                  {alertPreview.map((alert) => (
                    <div key={alert.id} className="space-y-1">
                      <Badge variant={alertLevelToBadgeVariant(alert.level)}>{alert.label}</Badge>
                      <p className="text-xs leading-relaxed text-slate-500">{alert.footnote}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <FormFields
              form={form}
              set={(key, value) => {
                set(key, value);
                if (key === "vehicle_id" && value) {
                  const selected = vehicleOptions.find((v) => v.value === value);
                  if (selected) set("plate", normalizePlate(selected.plate));
                }
              }}
              fields={[
                { name: "code", label: "Código", required: true },
                {
                  name: "vehicle_id",
                  label: "Veículo da frota (cadastro)",
                  type: "select",
                  required: true,
                  options: [
                    { value: "", label: "— Selecione um veículo cadastrado —" },
                    ...vehicleOptions.map((v) => ({ value: v.value, label: v.label })),
                  ],
                },
                { name: "infraction_date", label: "Data da infração", type: "date", required: true },
                { name: "ait_number", label: "Nº AIT / Auto de infração" },
                { name: "description", label: "Descrição / Enquadramento" },
                { name: "points", label: "Pontos na CNH", type: "number" },
                { name: "amount", label: "Valor da multa (R$)", type: "number" },
                {
                  name: "driver_id",
                  label: "Motorista responsável",
                  type: "select",
                  options: driverOptions,
                },
                {
                  name: "assignment_status",
                  label: "Status da atribuição interna",
                  type: "select",
                  required: true,
                  options: INFRACTION_ASSIGNMENT_STATUS.map((s) => ({ value: s, label: s })),
                },
                { name: "notes", label: "Observações", type: "textarea" },
              ]}
            />

            <label className="block max-w-xs space-y-1">
              <span className="text-sm font-medium text-slate-700">Placa</span>
              <input
                type="text"
                readOnly
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                value={String(form.plate ?? "")}
                placeholder="Selecione o veículo acima"
              />
              <span className="text-xs text-slate-500">
                Preenchida automaticamente a partir do cadastro de veículos — não é possível informar placa fora da frota.
              </span>
            </label>

            {vehicleOptions.length === 0 && (
              <Alert variant="warning">
                Nenhum veículo ativo na frota. Cadastre a placa em Cadastros → Veículos antes de registrar a infração.
              </Alert>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-700">Cruzamento automático</p>
              <p className="mt-1 text-xs text-slate-500">
                Busca ordem de serviço cuja data da infração está entre entrada e saída (ou data do
                serviço). Se não encontrar, consulta lançamentos financeiros na mesma data.
              </p>
              <p className="mt-2 text-xs italic text-slate-500">
                {INFRACTION_ALERT_FOOTNOTES["assign-driver"]}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={suggesting || !form.vehicle_id || !form.infraction_date || !companyId}
                  onClick={async () => {
                    if (!companyId) return;
                    setSuggesting(true);
                    setSuggestError(null);
                    setSuggestion(null);
                    try {
                      const result = await suggestDriverForInfraction(
                        companyId,
                        String(form.vehicle_id),
                        String(form.infraction_date)
                      );
                      if (!result) {
                        setSuggestError(
                          "Nenhum motorista encontrado para esta placa e data. Atribua manualmente."
                        );
                        return;
                      }
                      setSuggestion(result);
                      set("driver_id", result.driver_id);
                      set("assignment_source", result.source);
                      if (result.service_order_id) {
                        set("service_order_id", result.service_order_id);
                      }
                      if (form.assignment_status === "Pendente") {
                        set("assignment_status", "Confirmado");
                      }
                    } finally {
                      setSuggesting(false);
                    }
                  }}
                >
                  {suggesting ? "Buscando..." : "Sugerir responsável"}
                </Button>
                {suggestion && (
                  <p className="text-sm text-green-700">
                    {suggestion.driver_name} — {suggestion.reason} (
                    {SOURCE_LABELS[suggestion.source]})
                  </p>
                )}
                {suggestError && <p className="text-sm text-amber-700">{suggestError}</p>}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Órgão autuador</p>
                <p className="text-xs text-slate-500">
                  Acompanhe se a indicação do motorista foi aceita pelo órgão autuador.
                </p>
                <p className="mt-2 text-xs italic text-slate-500">
                  {INFRACTION_ALERT_FOOTNOTES["awaiting-authority"]}
                </p>
              </div>
              <FormFields
                form={form}
                set={(key, value) => {
                  set(key, value);
                  if (key === "authority_status") {
                    if (value === "Indicado" && !form.authority_indicated_at) {
                      set("authority_indicated_at", new Date().toISOString().slice(0, 10));
                    }
                    if (
                      (value === "Aceito" || value === "Recusado") &&
                      !form.authority_responded_at
                    ) {
                      set("authority_responded_at", new Date().toISOString().slice(0, 10));
                    }
                  }
                }}
                fields={[
                  {
                    name: "authority_status",
                    label: "Status no órgão autuador",
                    type: "select",
                    required: true,
                    options: INFRACTION_AUTHORITY_STATUS.map((s) => ({
                      value: s,
                      label: getAuthorityStatusLabel(s),
                    })),
                  },
                  { name: "authority_indicated_at", label: "Data da indicação", type: "date" },
                  { name: "authority_responded_at", label: "Data da resposta do órgão", type: "date" },
                ]}
              />
              {form.authority_status === "Recusado" && (
                <Alert variant="error">
                  {INFRACTION_ALERT_FOOTNOTES["authority-refused"]}
                </Alert>
              )}
              {form.authority_status === "Aceito" && (
                <Alert variant="info">
                  {INFRACTION_ALERT_FOOTNOTES["awaiting-payment-proof"]}
                </Alert>
              )}
            </div>

            <div className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Comprovante de pagamento</p>
                <p className="mt-2 text-xs italic text-slate-500">
                  {INFRACTION_ALERT_FOOTNOTES["validate-payment"]}
                </p>
              </div>
              <FormFields
                form={form}
                set={set}
                fields={[
                  {
                    name: "payment_proof_status",
                    label: "Status do comprovante",
                    type: "select",
                    required: true,
                    options: INFRACTION_PAYMENT_PROOF_STATUS.map((s) => ({
                      value: s,
                      label: getPaymentProofStatusLabel(s),
                    })),
                  },
                  {
                    name: "payment_proof_received_at",
                    label: "Data de apresentação pelo motorista",
                    type: "date",
                  },
                  {
                    name: "payment_validated_at",
                    label: "Data de validação / baixa",
                    type: "date",
                  },
                ]}
              />

              {companyId && (
                <InfractionPaymentProofSection
                  companyId={companyId}
                  infractionId={savedId}
                  paymentProofStatus={String(form.payment_proof_status)}
                  onStatusChange={(patch) => {
                    for (const [key, value] of Object.entries(patch)) {
                      set(key, value);
                    }
                  }}
                />
              )}

              {form.payment_proof_status === "Apresentado" && (
                <Alert variant="warning">
                  {INFRACTION_ALERT_FOOTNOTES["validate-payment"]}
                </Alert>
              )}
            </div>

            <div className="space-y-4 rounded-lg border border-green-200 bg-green-50/40 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Baixa e arquivamento</p>
                <p className="mt-2 text-xs italic text-slate-500">
                  {INFRACTION_ALERT_FOOTNOTES["ready-closure"]} {INFRACTION_ALERT_FOOTNOTES["ready-archive"]}
                </p>
              </div>
              <FormFields
                form={form}
                set={set}
                fields={[
                  {
                    name: "case_status",
                    label: "Status do processo",
                    type: "select",
                    required: true,
                    options: INFRACTION_CASE_STATUS.map((s) => ({
                      value: s,
                      label: getCaseStatusLabel(s),
                    })),
                  },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    form.authority_status !== "Aceito" ||
                    form.payment_proof_status !== "Validado" ||
                    form.case_status !== "EmAndamento"
                  }
                  onClick={() => {
                    set("case_status", "Baixada");
                    if (!form.payment_validated_at) {
                      set("payment_validated_at", new Date().toISOString().slice(0, 10));
                    }
                  }}
                >
                  Marcar como baixada
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={form.case_status !== "Baixada"}
                  onClick={() => set("case_status", "Arquivada")}
                >
                  Arquivar processo
                </Button>
              </div>
              {form.case_status === "Arquivada" && (
                <Alert variant="info">{INFRACTION_ALERT_FOOTNOTES.archived}</Alert>
              )}
            </div>
          </div>
        );
      }}
    </EntityForm>
  );
}
