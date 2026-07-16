"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import {
  allowsParking,
  PARKING_BILLING_MODES,
  type ParkingBillingMode,
  type ParkingEntryRow,
  type PatioVehicleType,
} from "@/lib/patio";
import {
  computeParkingTotals,
  createParkingEntry,
  finalizeParkingEntry,
  listPatioVehicleTypes,
  seedPatioDefaults,
} from "@/lib/patio-api";
import { PatioPaymentProofClip } from "@/components/operacional/PatioPaymentProofClip";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateTimeBR } from "@/lib/utils";

export default function EstacionamentoPage() {
  const { companyId } = useCompany();
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("operacional.estacionamento");
  const supabase = useMemo(() => createClient(), []);
  const [types, setTypes] = useState<PatioVehicleType[]>([]);
  const [rows, setRows] = useState<ParkingEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [quotedRate, setQuotedRate] = useState<number | null>(null);
  const [quotedAdditional, setQuotedAdditional] = useState<number | null>(null);
  const [exitDraft, setExitDraft] = useState<Record<string, { date: string; time: string }>>({});

  const [form, setForm] = useState({
    plate: "",
    brand: "",
    model: "",
    vehicle_type_id: "",
    client_name: "",
    phone: "",
    entry_date: new Date().toISOString().slice(0, 10),
    entry_time: new Date().toTimeString().slice(0, 5),
    billing_mode: "Diária" as ParkingBillingMode,
    notes: "",
  });

  const parkingTypes = types.filter((t) => t.is_active && allowsParking(t.usage_category));

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    await seedPatioDefaults(supabase, companyId);
    const [tRes, eRes] = await Promise.all([
      listPatioVehicleTypes(supabase, companyId, true),
      supabase
        .from("parking_entries")
        .select("*")
        .eq("company_id", companyId)
        .order("entry_date", { ascending: false })
        .limit(100),
    ]);
    if (tRes.error || eRes.error) setError(tRes.error ?? eRes.error?.message ?? null);
    setTypes(tRes.rows);
    setRows((eRes.data as ParkingEntryRow[]) ?? []);
    if (!form.vehicle_type_id && tRes.rows[0]) {
      const first = tRes.rows.find((r) => allowsParking(r.usage_category));
      if (first) setForm((f) => ({ ...f, vehicle_type_id: first.id }));
    }
    setLoading(false);
  }, [companyId, supabase, form.vehicle_type_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!companyId || !form.vehicle_type_id || !form.entry_date) {
      setQuotedRate(null);
      setQuotedAdditional(null);
      return;
    }
    let cancelled = false;
    void computeParkingTotals({
      supabase,
      companyId,
      vehicleTypeId: form.vehicle_type_id,
      billingMode: form.billing_mode,
      entryDate: form.entry_date,
      entryTime: form.entry_time,
      exitDate: null,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setQuotedRate(null);
        setQuotedAdditional(null);
      } else {
        setQuotedRate(result.dailyRate);
        setQuotedAdditional(result.additionalRate);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    companyId,
    form.vehicle_type_id,
    form.billing_mode,
    form.entry_date,
    form.entry_time,
    supabase,
  ]);

  function quoteLabel(): string {
    if (quotedRate == null) return "— sem preço —";
    if (form.billing_mode === "Rotativo") {
      const extra =
        quotedAdditional != null ? ` · demais ${formatCurrency(quotedAdditional)}` : "";
      return `1ª h ${formatCurrency(quotedRate)}${extra}`;
    }
    if (form.billing_mode === "Mensal") return `${formatCurrency(quotedRate)} / mês`;
    return `${formatCurrency(quotedRate)} / diária`;
  }

  function rateUnitLabel(mode: string | null | undefined): string {
    if (mode === "Mensal") return "mensal";
    if (mode === "Rotativo") return "1ª h";
    return "diária";
  }

  function totalBreakdown(row: ParkingEntryRow): string | null {
    if (row.daily_count == null || row.daily_rate == null) return null;
    if (row.billing_mode === "Rotativo") {
      const hours = Number(row.daily_count);
      if (hours <= 1) return "1 hora";
      return `${hours} horas (1ª + ${hours - 1} adicional)`;
    }
    return `${row.daily_count} × ${formatCurrency(Number(row.daily_rate))}`;
  }

  const openEntry = async () => {
    if (!companyId) return;
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para abrir entradas.");
      return;
    }
    const type = parkingTypes.find((t) => t.id === form.vehicle_type_id);
    if (!form.plate.trim() || !type) {
      setError("Informe placa e porte do veículo.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: createError } = await createParkingEntry(supabase, companyId, {
      plate: form.plate,
      brand: form.brand,
      model: form.model,
      vehicleTypeId: type.id,
      vehicleTypeName: type.name,
      clientName: form.client_name,
      phone: form.phone,
      entryDate: form.entry_date,
      entryTime: form.entry_time,
      billingMode: form.billing_mode,
      notes: form.notes,
    });
    setSaving(false);
    if (createError) {
      setError(createError);
      return;
    }
    setForm((f) => ({
      ...f,
      plate: "",
      brand: "",
      model: "",
      client_name: "",
      phone: "",
      notes: "",
    }));
    await load();
  };

  const closeEntry = async (row: ParkingEntryRow) => {
    if (!companyId) return;
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para finalizar.");
      return;
    }
    const draft = exitDraft[row.id] ?? {
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toTimeString().slice(0, 5),
    };
    if (!draft.date) {
      setError("Informe a data de saída.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: finError } = await finalizeParkingEntry(
      supabase,
      companyId,
      row.id,
      draft.date,
      draft.time
    );
    setSaving(false);
    if (finError) {
      setError(finError);
      return;
    }
    await load();
  };

  if (!companyId) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Estacionamento</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ordem própria do pátio — preços em{" "}
            <Link href="/configuracoes/parametros-patio" className="text-brand-700 underline">
              Parâmetros do pátio
            </Link>
            .
          </p>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {!canEdit ? (
        <Alert variant="info">
          Modo visualização: você pode consultar as ordens, mas não abrir nem finalizar entradas.
        </Alert>
      ) : null}
      {loading ? <Loading /> : null}

      {canEdit ? (
      <section className={`space-y-4 ${glassFilterPanel()}`}>
        <h2 className="text-sm font-semibold text-slate-900">Abrir entrada</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Placa</span>
            <input
              className={glassField(true)}
              value={form.plate}
              onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))}
            />
          </label>
          <GlassSelect
            label="Porte"
            required
            value={form.vehicle_type_id}
            onChange={(next) => setForm((f) => ({ ...f, vehicle_type_id: next }))}
            options={parkingTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
          <GlassSelect
            label="Cobrança"
            required
            value={form.billing_mode}
            onChange={(next) => setForm((f) => ({ ...f, billing_mode: next as ParkingBillingMode }))}
            options={PARKING_BILLING_MODES.map((m) => ({
              value: m,
              label: m === "Rotativo" ? "Rotativo (por hora)" : m,
            }))}
          />
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Valor (tabela)</span>
            <input className={glassField(false)} readOnly value={quoteLabel()} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Data entrada</span>
            <input
              type="date"
              className={glassField(true)}
              value={form.entry_date}
              onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Hora entrada</span>
            <input
              type="time"
              className={glassField(true)}
              value={form.entry_time}
              onChange={(e) => setForm((f) => ({ ...f, entry_time: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Cliente</span>
            <input
              className={glassField(false)}
              value={form.client_name}
              onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Telefone</span>
            <input
              className={glassField(false)}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Marca</span>
            <input
              className={glassField(false)}
              value={form.brand}
              onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Modelo</span>
            <input
              className={glassField(false)}
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            />
          </label>
        </div>
        <Button type="button" disabled={saving || quotedRate == null} onClick={() => void openEntry()}>
          Abrir ordem de estacionamento
        </Button>
      </section>
      ) : null}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Porte</th>
              <th className="px-3 py-2">Entrada</th>
              <th className="px-3 py-2">Saída / fechar</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Comprovante</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = exitDraft[row.id] ?? {
                date: new Date().toISOString().slice(0, 10),
                time: new Date().toTimeString().slice(0, 5),
              };
              return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{row.code}</td>
                  <td className="px-3 py-2">{row.plate}</td>
                  <td className="px-3 py-2">{row.vehicle_type ?? "—"}</td>
                  <td className="px-3 py-2">
                    {formatDateTimeBR(row.entry_date, row.entry_time)}
                    <div className="text-xs text-slate-500">{row.billing_mode ?? "Diária"}</div>
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "Aberto" && canEdit ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <input
                          type="date"
                          className={`${glassField(true)} w-auto`}
                          value={draft.date}
                          onChange={(e) =>
                            setExitDraft((d) => ({
                              ...d,
                              [row.id]: { ...draft, date: e.target.value },
                            }))
                          }
                        />
                        <input
                          type="time"
                          className={`${glassField(false)} w-auto`}
                          value={draft.time}
                          onChange={(e) =>
                            setExitDraft((d) => ({
                              ...d,
                              [row.id]: { ...draft, time: e.target.value },
                            }))
                          }
                        />
                        <Button
                          type="button"
                          disabled={saving}
                          onClick={() => void closeEntry(row)}
                        >
                          Finalizar
                        </Button>
                      </div>
                    ) : row.status === "Aberto" ? (
                      <span className="text-slate-500">Aberto</span>
                    ) : (
                      <span>{formatDateTimeBR(row.exit_date, row.exit_time)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.daily_rate != null ? (
                      <>
                        {formatCurrency(Number(row.daily_rate))}
                        <div className="text-xs text-slate-500">
                          {rateUnitLabel(row.billing_mode)}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {companyId ? (
                      <PatioPaymentProofClip
                        companyId={companyId}
                        entityType="parking_entry"
                        entityId={row.id}
                        code={row.code}
                        canUpload={canEdit}
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {row.total_amount != null ? formatCurrency(Number(row.total_amount)) : "—"}
                    {totalBreakdown(row) ? (
                      <div className="text-xs text-slate-500">{totalBreakdown(row)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        row.status === "Finalizado"
                          ? "success"
                          : row.status === "Cancelado"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  Nenhuma ordem ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
