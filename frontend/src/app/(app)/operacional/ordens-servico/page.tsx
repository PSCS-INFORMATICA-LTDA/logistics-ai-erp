"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { FreightCalculatorPanel } from "@/components/operacional/FreightCalculatorPanel";
import { FreightPerDiemPanel } from "@/components/operacional/FreightPerDiemPanel";
import { ServiceCategoryPicker } from "@/components/operacional/ServiceCategoryPicker";
import { ServiceOrderListFilters } from "@/components/operacional/ServiceOrderListFilters";
import { ServiceOrderRowActions } from "@/components/operacional/ServiceOrderRowActions";
import { Badge, Alert } from "@/components/ui/Badge";
import { nextCode } from "@/lib/codes";
import { useCompany } from "@/lib/company-context";
import {
  categoriesForServiceType,
  formatServiceCategories,
  resolveDreAccountName,
} from "@/lib/service-order-categories";
import { createClient } from "@/lib/supabase/client";
import { fetchActiveFleetVehicles, fleetVehicleLabel } from "@/lib/fleet-vehicles";
import { requiresPerDiem } from "@/lib/freight-per-diem";
import { isTruckCategory } from "@/lib/transport-van-estimate";
import {
  canEditServiceOrder,
  isPendingClientProposal,
  isPendingDriverAssignment,
  isDriverAssignmentRejected,
  needsDriverAssignment,
  matchesServiceOrderStatusFilter,
  resolveServiceOrderDisplayStatus,
  resolveServiceOrderDriverColumnLabel,
  serviceOrderEditBlockedReason,
  serviceOrderStatusVariant,
} from "@/lib/service-order-display-status";
import {
  daysWaitingProposal,
  isProposalFollowUpOverdue,
} from "@/lib/service-order-proposal-api";
import {
  matchesServiceOrderFilters,
  type ServiceOrderListRow,
} from "@/lib/service-order-filters";
import { formatCurrency, normalizePlate } from "@/lib/utils";
import type { DreAccount, Driver, DriverAssignmentResponse, Vehicle } from "@/types/database";
import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE_LABELS,
  SERVICE_ORDER_TYPES,
} from "@/types/database";

function serviceTypeLabel(type: string): string {
  return SERVICE_ORDER_TYPE_LABELS[type] ?? type;
}

function OrdensServicoPageContent() {
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("q") ?? searchParams.get("code") ?? "";
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState("");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("");
  const [pendingProposalsFilter, setPendingProposalsFilter] = useState(false);
  const [listRows, setListRows] = useState<ServiceOrderListRow[]>([]);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [dreAccounts, setDreAccounts] = useState<DreAccount[]>([]);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const [driversRes, fleetRes, dreRes] = await Promise.all([
        supabase
          .from("drivers")
          .select("id, code, name, status, active_for_operations")
          .eq("company_id", companyId)
          .eq("status", "Ativo")
          .is("deleted_at", null)
          .order("name"),
        fetchActiveFleetVehicles(supabase, companyId),
        supabase
          .from("chart_of_accounts")
          .select("id, name, classification, transaction_type, status")
          .eq("company_id", companyId)
          .eq("status", "Ativo")
          .eq("transaction_type", "Receita")
          .order("name"),
      ]);

      setDrivers((driversRes.data as Driver[]) ?? []);
      setVehicles(fleetRes.vehicles);
      setVehiclesError(fleetRes.error);
      setDreAccounts((dreRes.data as DreAccount[]) ?? []);
    })();
  }, [companyId, supabase]);

  const dreAccountOptions = useMemo(
    () => [
      { value: "", label: "— Automático pela natureza —" },
      ...dreAccounts.map((a) => ({ value: a.id, label: a.name })),
    ],
    [dreAccounts]
  );

  const transformItems = useCallback(
    async (items: ServiceOrderListRow[]) => {
      const driverIds = [
        ...new Set(
          items
            .flatMap((i) => [
              i.driver_id,
              i.proposed_driver_id,
              ...(i.driver_assignment_rejected_driver_ids ?? []),
            ])
            .filter(Boolean)
        ),
      ] as string[];
      const dreIds = [...new Set(items.map((i) => i.chart_of_account_id).filter(Boolean))] as string[];

      const [driversRes, dreRes] = await Promise.all([
        driverIds.length
          ? supabase.from("drivers").select("id, name, code").in("id", driverIds)
          : Promise.resolve({ data: [] }),
        dreIds.length
          ? supabase.from("chart_of_accounts").select("id, name").in("id", dreIds)
          : Promise.resolve({ data: [] }),
      ]);

      const nameById = new Map((driversRes.data ?? []).map((d) => [d.id, d.name as string]));
      const codeById = new Map((driversRes.data ?? []).map((d) => [d.id, d.code as string]));
      const dreById = new Map((dreRes.data ?? []).map((d) => [d.id, d.name as string]));

      const rows = items.map((item) => {
        const rejectedIds = item.driver_assignment_rejected_driver_ids ?? [];
        const driverIdForLabel =
          item.driver_id ??
          item.proposed_driver_id ??
          (item.driver_assignment_response === "rejected" && rejectedIds.length
            ? rejectedIds[rejectedIds.length - 1]
            : null);
        return {
          ...item,
          driver_assignment_rejected_driver_ids: rejectedIds,
          driver_name: driverIdForLabel ? nameById.get(driverIdForLabel) : undefined,
          proposed_driver_code: item.proposed_driver_id
            ? codeById.get(item.proposed_driver_id)
            : undefined,
          dre_account_name: item.chart_of_account_id
            ? dreById.get(item.chart_of_account_id)
            : undefined,
          service_categories: item.service_categories ?? [],
          proposal_response: item.proposal_response ?? "pending",
          proposal_follow_up_count: item.proposal_follow_up_count ?? 0,
          driver_assignment_response: item.driver_assignment_response ?? "pending",
        };
      });
      setListRows(rows);
      return rows;
    },
    [supabase]
  );

  const filterItem = useCallback(
    (row: ServiceOrderListRow) =>
      matchesServiceOrderFilters(row, {
        search: searchQuery,
        status: statusFilter,
        serviceType: serviceTypeFilter,
        pendingProposals: pendingProposalsFilter,
      }),
    [searchQuery, statusFilter, serviceTypeFilter, pendingProposalsFilter]
  );

  const handleFollowUpRegistered = useCallback(
    (orderId: string, count: number, lastAt: string | null) => {
      setListRows((rows) =>
        rows.map((row) =>
          row.id === orderId
            ? {
                ...row,
                proposal_follow_up_count: count,
                proposal_last_follow_up_at: lastAt,
              }
            : row
        )
      );
    },
    []
  );

  const handleProposalResponseChanged = useCallback(
    (
      orderId: string,
      patch: {
        proposal_response: ServiceOrderListRow["proposal_response"];
        status: string;
        proposal_accepted_at?: string | null;
        proposal_rejected_at?: string | null;
      }
    ) => {
      setListRows((rows) =>
        rows.map((row) => (row.id === orderId ? { ...row, ...patch } : row))
      );
      setListRefreshKey((key) => key + 1);
    },
    []
  );

  const handleDriverAssigned = useCallback(
    (orderId: string, driverId: string, driverName: string) => {
      setListRows((rows) =>
        rows.map((row) =>
          row.id === orderId ? { ...row, driver_id: driverId, driver_name: driverName } : row
        )
      );
      setListRefreshKey((key) => key + 1);
    },
    []
  );

  const handleAssignmentSent = useCallback(
    (orderId: string, driverId: string, driverName: string) => {
      setListRows((rows) =>
        rows.map((row) =>
          row.id === orderId
            ? {
                ...row,
                proposed_driver_id: driverId,
                driver_assignment_response: "pending" as const,
                driver_assignment_sent_at: new Date().toISOString(),
                driver_id: null,
                driver_name: driverName,
              }
            : row
        )
      );
      setListRefreshKey((key) => key + 1);
    },
    []
  );

  const handleDriverAssignmentResponded = useCallback(
    (
      orderId: string,
      patch: {
        driver_assignment_response: DriverAssignmentResponse;
        driver_id: string | null;
        proposed_driver_id: string | null;
        driver_assignment_rejected_driver_ids?: string[];
      }
    ) => {
      setListRows((rows) =>
        rows.map((row) =>
          row.id === orderId
            ? {
                ...row,
                driver_assignment_response: patch.driver_assignment_response,
                driver_id: patch.driver_id,
                proposed_driver_id: patch.proposed_driver_id,
                driver_assignment_rejected_driver_ids:
                  patch.driver_assignment_rejected_driver_ids ??
                  row.driver_assignment_rejected_driver_ids,
              }
            : row
        )
      );
      setListRefreshKey((key) => key + 1);
    },
    []
  );

  const handleDriverAssignmentReset = useCallback((orderId: string) => {
    setListRows((rows) =>
      rows.map((row) =>
        row.id === orderId
          ? {
              ...row,
              proposed_driver_id: null,
              driver_assignment_sent_at: null,
              driver_assignment_response: "pending" as const,
              driver_assignment_accepted_at: null,
              driver_assignment_rejected_at: null,
              driver_id: null,
              driver_name: undefined,
              driver_assignment_rejected_driver_ids: [],
            }
          : row
      )
    );
    setListRefreshKey((key) => key + 1);
  }, []);

  const visibleCount = useMemo(
    () => listRows.filter(filterItem).length,
    [listRows, filterItem]
  );

  const vehicleOptions = vehicles.map((v) => ({
    value: v.id,
    label: fleetVehicleLabel(v),
    plate: v.plate,
    axle_count: v.axle_count,
    model: v.model,
    year: v.year,
    vehicle_category: v.vehicle_category,
  }));

  const driverOptions = [
    { value: "", label: "— Sem motorista —" },
    ...drivers.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
  ];

  const resolveChartOfAccountId = (
    categories: string[],
    manualId: string
  ): string | null => {
    if (manualId) return manualId;
    const dreName = resolveDreAccountName(categories);
    if (!dreName) return null;
    return dreAccounts.find((a) => a.name === dreName)?.id ?? null;
  };

  return (
    <CrudPage<ServiceOrderListRow>
      refreshKey={listRefreshKey}
      title="Ordens de Serviço"
      description="Transporte, estacionamento e lava-rápido — natureza do serviço vinculada às contas DRE"
      table="service_orders"
      orderBy="service_date"
      softDelete={false}
      transformItems={transformItems}
      filterItem={filterItem}
      canEditRow={canEditServiceOrder}
      editBlockedReason={serviceOrderEditBlockedReason}
      toolbar={
        <div className="space-y-4">
          <ServiceOrderListFilters
            search={searchQuery}
            status={statusFilter}
            serviceType={serviceTypeFilter}
            pendingProposals={pendingProposalsFilter}
            totalCount={listRows.length}
            visibleCount={visibleCount}
            onSearchChange={setSearchQuery}
            onStatusChange={setStatusFilter}
            onServiceTypeChange={setServiceTypeFilter}
            onPendingProposalsChange={setPendingProposalsFilter}
          />
          {vehiclesError ? (
            <Alert variant="error">
              Não foi possível carregar a frota: {vehiclesError}
            </Alert>
          ) : null}
        </div>
      }
      renderRowActions={(row) => (
        <ServiceOrderRowActions
          row={row}
          onFollowUpRegistered={handleFollowUpRegistered}
          onProposalResponseChanged={handleProposalResponseChanged}
          onDriverAssigned={handleDriverAssigned}
          onAssignmentSent={handleAssignmentSent}
          onDriverAssignmentReset={handleDriverAssignmentReset}
          onDriverAssignmentResponded={handleDriverAssignmentResponded}
        />
      )}
      columns={[
        { key: "code", label: "Código" },
        { key: "service_date", label: "Data" },
        { key: "plate", label: "Placa" },
        {
          key: "service_type",
          label: "Tipo",
          render: (r) => serviceTypeLabel(r.service_type),
        },
        {
          key: "service_categories",
          label: "Natureza",
          render: (r) =>
            r.service_categories?.length
              ? formatServiceCategories(r.service_categories)
              : r.service_name ?? "—",
        },
        {
          key: "dre_account_name",
          label: "Conta DRE",
          render: (r) => r.dre_account_name ?? "—",
        },
        {
          key: "driver_name",
          label: "Motorista",
          render: (r) => {
            const label = resolveServiceOrderDriverColumnLabel(r);
            if (isDriverAssignmentRejected(r)) {
              return <span className="font-medium text-red-700">{label}</span>;
            }
            if (needsDriverAssignment(r) && !isPendingDriverAssignment(r)) {
              return <span className="font-medium text-amber-700">{label}</span>;
            }
            return label;
          },
        },
        {
          key: "proposal_sent_at",
          label: "Dias aguardando",
          render: (r) => {
            if (!isPendingClientProposal(r) || !r.proposal_sent_at) return "—";
            const days = daysWaitingProposal(r.proposal_sent_at);
            const overdue = isProposalFollowUpOverdue(r.proposal_sent_at, r.proposal_response ?? "pending");
            return (
              <span className={overdue ? "font-medium text-amber-700" : undefined}>
                {days != null ? `${days} dia(s)` : "—"}
                {overdue ? " (+48h)" : ""}
              </span>
            );
          },
        },
        {
          key: "status",
          label: "Status",
          render: (r) => {
            const label = resolveServiceOrderDisplayStatus(r);
            return <Badge variant={serviceOrderStatusVariant(r)}>{label}</Badge>;
          },
        },
        {
          key: "service_amount",
          label: "Valor",
          render: (r) => {
            const amount = r.freight_agreed_amount ?? r.service_amount;
            return amount != null ? formatCurrency(amount) : "—";
          },
        },
      ]}
      renderForm={({ item, onSave, onCancel, saving }) => (
        <EntityForm
          saving={saving}
          onCancel={onCancel}
          initial={{
            code: item?.code ?? "",
            service_type: item?.service_type ?? "Transporte",
            service_date: item?.service_date ?? new Date().toISOString().slice(0, 10),
            vehicle_id: item?.vehicle_id ?? "",
            plate: item?.plate ?? "",
            vehicle_type: item?.vehicle_type ?? "",
            driver_id: item?.driver_id ?? "",
            client_name: item?.client_name ?? "",
            phone: item?.phone ?? "",
            service_categories:
              item?.service_categories?.length
                ? item.service_categories
                : categoriesForServiceType(item?.service_type ?? "Transporte"),
            chart_of_account_id: item?.chart_of_account_id ?? "",
            service_amount: item?.service_amount ?? "",
            status: item?.status ?? "Aberto",
            entry_date: item?.entry_date ?? "",
            exit_date: item?.exit_date ?? "",
            notes: item?.notes ?? "",
            freight_origin_address: item?.freight_origin_address ?? "",
            freight_destination_address: item?.freight_destination_address ?? "",
            freight_distance_km: item?.freight_distance_km ?? "",
            freight_toll_amount: item?.freight_toll_amount ?? "",
            freight_toll_count: item?.freight_toll_count ?? "",
            freight_toll_detail: item?.freight_toll_detail ?? null,
            freight_antt_cargo_type: item?.freight_antt_cargo_type ?? 5,
            freight_antt_axles: item?.freight_antt_axles ?? "",
            freight_antt_composicao_veicular: item?.freight_antt_composicao_veicular ?? true,
            freight_antt_alto_desempenho: item?.freight_antt_alto_desempenho ?? false,
            freight_antt_retorno_vazio: item?.freight_antt_retorno_vazio ?? false,
            freight_antt_minimum: item?.freight_antt_minimum ?? "",
            freight_suggested_total: item?.freight_suggested_total ?? "",
            freight_agreed_amount: item?.freight_agreed_amount ?? "",
            freight_antt_detail: item?.freight_antt_detail ?? null,
            freight_travel_days: item?.freight_travel_days ?? "",
            freight_per_diem_detail: item?.freight_per_diem_detail ?? null,
            freight_per_diem_total: item?.freight_per_diem_total ?? "",
            freight_per_diem_charge_to: item?.freight_per_diem_charge_to ?? "Cliente",
            freight_transport_km_rate: item?.freight_transport_km_rate ?? "",
          }}
          onSubmit={async (data) => {
            const categories = Array.isArray(data.service_categories)
              ? (data.service_categories as string[])
              : [];

            if (categories.length === 0) {
              window.alert("Selecione ao menos uma natureza de serviço (Transporte, Frete, etc.).");
              return;
            }

            if (!item?.id && companyId && !data.code) {
              data.code = await nextCode("service_orders", companyId, "OS");
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

            if (!isTruckCategory(selectedVehicle.vehicle_category)) {
              data.freight_antt_axles = null;
            } else if (data.freight_antt_axles === "") {
              data.freight_antt_axles = selectedVehicle.axle_count ?? 5;
            }

            if (data.service_amount === "") data.service_amount = null;

            if (data.service_type === "Frete" && data.freight_agreed_amount) {
              data.service_amount = Number(data.freight_agreed_amount) || data.service_amount;
            }

            data.service_name = formatServiceCategories(categories);
            data.service_categories = categories;
            data.chart_of_account_id = resolveChartOfAccountId(
              categories,
              String(data.chart_of_account_id ?? "")
            );

            for (const key of [
              "freight_origin_address",
              "freight_destination_address",
              "freight_distance_km",
              "freight_toll_amount",
              "freight_toll_count",
              "freight_antt_minimum",
              "freight_suggested_total",
              "freight_agreed_amount",
              "freight_travel_days",
              "freight_per_diem_total",
              "freight_antt_axles",
              "freight_transport_km_rate",
            ]) {
              if (data[key] === "") data[key] = null;
            }

            if (!data.freight_travel_days || Number(data.freight_travel_days) <= 0) {
              data.freight_travel_days = null;
              data.freight_per_diem_detail = null;
              data.freight_per_diem_total = null;
            }

            if (!requiresPerDiem(Number(data.freight_distance_km) || 0)) {
              data.freight_travel_days = null;
              data.freight_per_diem_detail = null;
              data.freight_per_diem_total = null;
              data.freight_per_diem_charge_to = "Cliente";
            }

            for (const key of [
              "vehicle_id",
              "driver_id",
              "client_name",
              "phone",
              "entry_date",
              "exit_date",
              "notes",
            ]) {
              if (data[key] === "") data[key] = null;
            }

            await onSave(data);
          }}
        >
          {({ form, set }) => {
            const categories = Array.isArray(form.service_categories)
              ? (form.service_categories as string[])
              : [];
            const suggestedDre = resolveDreAccountName(categories);
            const selectedDreId = String(form.chart_of_account_id ?? "");
            const dreLabel =
              dreAccounts.find((a) => a.id === selectedDreId)?.name ??
              suggestedDre ??
              null;

            const isFrete = String(form.service_type) === "Frete";
            const showRoutePanel = isFrete || String(form.service_type) === "Transporte";

            const handleServiceTypeChange = (value: string) => {
              set("service_type", value);
              set("service_categories", categoriesForServiceType(value));
              set("chart_of_account_id", "");
              const currentVehicle = vehicleOptions.find(
                (v) => v.value === String(form.vehicle_id ?? "")
              );
              if (isTruckCategory(currentVehicle?.vehicle_category)) {
                set("freight_antt_axles", currentVehicle?.axle_count ?? 5);
              } else {
                set("freight_antt_axles", "");
              }
            };

            const handleVehicleChange = (vehicleId: string) => {
              set("vehicle_id", vehicleId);
              if (!vehicleId) {
                set("plate", "");
                set("freight_antt_axles", "");
                return;
              }
              const selected = vehicleOptions.find((v) => v.value === vehicleId);
              if (!selected) return;
              set("plate", normalizePlate(selected.plate));
              if (selected.model) set("model", selected.model);
              if (selected.year) set("year", selected.year);
              if (selected.vehicle_category) set("vehicle_type", selected.vehicle_category);
              if (isTruckCategory(selected.vehicle_category) && selected.axle_count != null) {
                set("freight_antt_axles", selected.axle_count);
              } else {
                set("freight_antt_axles", "");
              }
            };

            return (
              <>
                <FormFields
                  form={form}
                  set={(key, value) => {
                    if (key === "service_type") {
                      handleServiceTypeChange(String(value));
                      return;
                    }
                    if (key === "vehicle_id") {
                      handleVehicleChange(String(value));
                      return;
                    }
                    set(key, value);
                  }}
                  fields={[
                    { name: "code", label: "Código", required: true },
                    {
                      name: "service_type",
                      label: "Tipo de operação",
                      type: "select",
                      required: true,
                      options: SERVICE_ORDER_TYPES.map((t) => ({
                        value: t,
                        label: serviceTypeLabel(t),
                      })),
                    },
                    { name: "service_date", label: "Data do serviço", type: "date", required: true },
                    {
                      name: "status",
                      label: "Status",
                      type: "select",
                      required: true,
                      options: SERVICE_ORDER_STATUS.map((s) => ({ value: s, label: s })),
                    },
                    { name: "entry_date", label: "Entrada (início do período)", type: "date" },
                    { name: "exit_date", label: "Saída (fim do período)", type: "date" },
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
                    {
                      name: "plate",
                      label: "Placa",
                      readOnly: true,
                      placeholder: "Selecione o veículo ao lado",
                      hint: "Preenchida automaticamente a partir do cadastro de veículos.",
                    },
                    {
                      name: "driver_id",
                      label: "Motorista",
                      type: "select",
                      options: driverOptions,
                    },
                    { name: "service_amount", label: "Valor (R$)", type: "number" },
                    { name: "client_name", label: "Cliente" },
                    { name: "phone", label: "Telefone" },
                    { name: "notes", label: "Observações", type: "textarea", colSpan: 2 },
                  ]}
                />

                {vehicleOptions.length === 0 && (
                  <Alert variant="warning">
                    Nenhum veículo ativo na frota. Cadastre em Cadastros → Veículos antes de abrir a OS.
                  </Alert>
                )}

                <VehicleSelectionSync
                  vehicleId={String(form.vehicle_id ?? "")}
                  vehicleOptions={vehicleOptions}
                  currentAxles={form.freight_antt_axles}
                  currentCategory={String(form.vehicle_type ?? "")}
                  set={set}
                />

                <VehicleFleetResolver
                  plate={String(form.plate ?? "")}
                  vehicleId={String(form.vehicle_id ?? "")}
                  vehicleOptions={vehicleOptions}
                  onResolve={handleVehicleChange}
                  onCategoryResolved={(vehicle) => {
                    if (vehicle.vehicle_category) set("vehicle_type", vehicle.vehicle_category);
                    if (isTruckCategory(vehicle.vehicle_category) && vehicle.axle_count != null) {
                      set("freight_antt_axles", vehicle.axle_count);
                    } else {
                      set("freight_antt_axles", "");
                    }
                  }}
                />

                <ServiceCategoryPicker
                  categories={categories}
                  dreAccountLabel={dreLabel}
                  onChange={(next) => set("service_categories", next)}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-700">Conta DRE (receita)</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={selectedDreId}
                      onChange={(e) => set("chart_of_account_id", e.target.value)}
                    >
                      {dreAccountOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-slate-500">
                      Deixe em automático para usar a conta sugerida pela natureza do serviço.
                    </span>
                  </label>
                </div>

                {showRoutePanel && (
                  <>
                    <FreightCalculatorPanel
                      form={form as Parameters<typeof FreightCalculatorPanel>[0]["form"]}
                      set={set}
                      mode={isFrete ? "frete" : "transporte"}
                      vehicleCategory={String(form.vehicle_type ?? "") || null}
                      onApplyAgreedToServiceAmount={(value) => set("service_amount", value)}
                    />
                    <FreightPerDiemPanel
                      distanceKm={Number(form.freight_distance_km) || 0}
                      travelDays={form.freight_travel_days as string | number}
                      perDiemDetail={
                        Array.isArray(form.freight_per_diem_detail)
                          ? (form.freight_per_diem_detail as Parameters<
                              typeof FreightPerDiemPanel
                            >[0]["perDiemDetail"])
                          : null
                      }
                      perDiemTotal={form.freight_per_diem_total as string | number}
                      chargeTo={String(form.freight_per_diem_charge_to ?? "Cliente")}
                      baseAmount={
                        (Number(form.freight_antt_minimum) || 0) +
                        (Number(form.freight_toll_amount) || 0)
                      }
                      set={set}
                      onSuggestedTotalChange={(value) => {
                        if (isFrete) {
                          set("freight_agreed_amount", value);
                          set("service_amount", value);
                        }
                      }}
                    />
                  </>
                )}
              </>
            );
          }}
        </EntityForm>
      )}
    />
  );
}

function VehicleSelectionSync({
  vehicleId,
  vehicleOptions,
  currentAxles,
  currentCategory,
  set,
}: {
  vehicleId: string;
  vehicleOptions: Array<{
    value: string;
    vehicle_category?: string;
    axle_count?: number | null;
  }>;
  currentAxles: unknown;
  currentCategory: string;
  set: (k: string, v: unknown) => void;
}) {
  useEffect(() => {
    if (!vehicleId || vehicleOptions.length === 0) return;
    const vehicle = vehicleOptions.find((v) => v.value === vehicleId);
    if (!vehicle?.vehicle_category) return;

    if (currentCategory !== vehicle.vehicle_category) {
      set("vehicle_type", vehicle.vehicle_category);
    }

    if (isTruckCategory(vehicle.vehicle_category)) {
      if (!currentAxles && vehicle.axle_count != null) {
        set("freight_antt_axles", vehicle.axle_count);
      }
      return;
    }

    if (currentAxles !== "" && currentAxles != null) {
      set("freight_antt_axles", "");
    }
  }, [vehicleId, vehicleOptions, currentAxles, currentCategory, set]);

  return null;
}

function VehicleFleetResolver({
  plate,
  vehicleId,
  vehicleOptions,
  onResolve,
  onCategoryResolved,
}: {
  plate: string;
  vehicleId: string;
  vehicleOptions: Array<{
    value: string;
    plate: string;
    vehicle_category?: string;
    axle_count?: number | null;
  }>;
  onResolve: (vehicleId: string) => void;
  onCategoryResolved?: (vehicle: (typeof vehicleOptions)[number]) => void;
}) {
  const resolvedRef = useRef(false);

  useEffect(() => {
    resolvedRef.current = false;
  }, [plate]);

  useEffect(() => {
    if (vehicleId) return;
    if (!plate || vehicleOptions.length === 0 || resolvedRef.current) return;
    const normalized = normalizePlate(plate);
    const match = vehicleOptions.find((v) => normalizePlate(v.plate) === normalized);
    if (!match) return;
    resolvedRef.current = true;
    onResolve(match.value);
    onCategoryResolved?.(match);
  }, [plate, vehicleId, vehicleOptions, onResolve, onCategoryResolved]);

  return null;
}

export default function OrdensServicoPage() {
  return (
    <Suspense fallback={null}>
      <OrdensServicoPageContent />
    </Suspense>
  );
}
