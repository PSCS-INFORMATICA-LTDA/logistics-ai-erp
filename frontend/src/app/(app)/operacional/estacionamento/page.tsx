"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GroupedTableBodies } from "@/components/ui/GroupedTableBodies";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { PatioPaymentProofClip } from "@/components/operacional/PatioPaymentProofClip";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { glassAction, glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { groupByKeySorted } from "@/lib/table-row-groups";
import {
  allowsParking,
  calcMensalPeriod,
  formatParkingDateBR,
  isMensalDueForRenewal,
  nextChargeFromPeriodEnd,
  PARKING_BILLING_MODES,
  type ParkingBillingMode,
  type ParkingEntryRow,
  type PatioVehicleType,
} from "@/lib/patio";
import {
  computeParkingTotals,
  createParkingEntry,
  estimateParkingTotal,
  finalizeParkingEntry,
  listPatioVehicleTypes,
  renewMensalParkingEntry,
  seedPatioDefaults,
} from "@/lib/patio-api";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateTimeBR } from "@/lib/utils";

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTime(): string {
  return new Date().toTimeString().slice(0, 5);
}

function defaultExitDraft(row: ParkingEntryRow): { date: string; time: string } {
  if (row.billing_mode === "Mensal" && row.period_end_date) {
    return { date: row.period_end_date, time: row.entry_time?.slice(0, 5) || "12:00" };
  }
  return { date: nowDate(), time: nowTime() };
}

export default function EstacionamentoPage() {
  const { companyId } = useCompany();
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("operacional.estacionamento");
  const supabase = useMemo(() => createClient(), []);
  const [types, setTypes] = useState<PatioVehicleType[]>([]);
  const [rows, setRows] = useState<ParkingEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [quotedRate, setQuotedRate] = useState<number | null>(null);
  const [quotedAdditional, setQuotedAdditional] = useState<number | null>(null);
  const [exitDraft, setExitDraft] = useState<Record<string, { date: string; time: string }>>({});
  const [liveTotals, setLiveTotals] = useState<
    Record<string, { total: number; units: number; label: string }>
  >({});
  const [liveTick, setLiveTick] = useState(0);

  const [form, setForm] = useState({
    plate: "",
    brand: "",
    model: "",
    vehicle_type_id: "",
    client_name: "",
    phone: "",
    entry_date: nowDate(),
    entry_time: nowTime(),
    billing_mode: "Diária" as ParkingBillingMode,
    period_end_date: calcMensalPeriod(nowDate()).periodEndDate,
    notes: "",
  });

  const parkingTypes = types.filter((t) => t.is_active && allowsParking(t.usage_category));

  const mensalNextCharge = useMemo(() => {
    if (form.billing_mode !== "Mensal" || !form.period_end_date) return null;
    return nextChargeFromPeriodEnd(form.period_end_date);
  }, [form.billing_mode, form.period_end_date]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.race([
        seedPatioDefaults(supabase, companyId),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 6000)),
      ]);
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
      setForm((f) => {
        if (f.vehicle_type_id) return f;
        const first = tRes.rows.find((r) => allowsParking(r.usage_category));
        return first ? { ...f, vehicle_type_id: first.id } : f;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o estacionamento.");
    } finally {
      setLoading(false);
    }
  }, [companyId, supabase]);

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

  useEffect(() => {
    const id = window.setInterval(() => setLiveTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    const openRows = rows.filter(
      (r) =>
        r.status === "Aberto" &&
        r.vehicle_type_id &&
        (r.billing_mode === "Rotativo" || r.billing_mode === "Diária")
    );
    if (openRows.length === 0) {
      setLiveTotals({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, { total: number; units: number; label: string }> = {};
      await Promise.all(
        openRows.map(async (row) => {
          const draft = exitDraft[row.id] ?? defaultExitDraft(row);
          const exitDate = draft.date || nowDate();
          const exitTime =
            row.billing_mode === "Rotativo" ? draft.time || nowTime() : draft.time || null;
          const est = await estimateParkingTotal({
            supabase,
            companyId,
            vehicleTypeId: row.vehicle_type_id!,
            billingMode: row.billing_mode as ParkingBillingMode,
            entryDate: row.entry_date,
            entryTime: row.entry_time,
            exitDate,
            exitTime,
          });
          if (est.error || est.total == null || est.hoursOrDays == null) return;
          const label =
            row.billing_mode === "Rotativo"
              ? est.hoursOrDays <= 1
                ? "1 hora"
                : `${est.hoursOrDays} horas`
              : est.hoursOrDays <= 1
                ? "1 diária"
                : `${est.hoursOrDays} diárias`;
          next[row.id] = { total: est.total, units: est.hoursOrDays, label };
        })
      );
      if (!cancelled) setLiveTotals(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, rows, exitDraft, liveTick, supabase]);

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
    if (row.billing_mode === "Mensal") return "1 mensalidade";
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
    setInfo(null);
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
      periodEndDate: form.billing_mode === "Mensal" ? form.period_end_date : null,
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
      period_end_date: calcMensalPeriod(f.entry_date).periodEndDate,
    }));
    await load();
  };

  const closeEntry = async (row: ParkingEntryRow) => {
    if (!companyId) return;
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para finalizar.");
      return;
    }
    const draft = exitDraft[row.id] ?? defaultExitDraft(row);
    if (!draft.date) {
      setError("Informe a data de saída.");
      return;
    }
    if (row.billing_mode === "Rotativo" && !draft.time?.trim()) {
      setError("Rotativo: informe a hora de saída para fechar a cobrança.");
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
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

  const renewMensal = async (row: ParkingEntryRow) => {
    if (!companyId || !canEdit) return;
    if (
      !window.confirm(
        `Renovar mensalidade da placa ${row.plate}?\n\nO período atual será finalizado e uma nova ordem abre na próxima cobrança (${formatParkingDateBR(row.next_charge_date)}).`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    const { row: created, error: renewError } = await renewMensalParkingEntry(
      supabase,
      companyId,
      row.id
    );
    setSaving(false);
    if (renewError) {
      setError(renewError);
      return;
    }
    setInfo(
      created
        ? `Mensalidade renovada: nova ordem ${created.code} de ${formatParkingDateBR(created.entry_date)} até ${formatParkingDateBR(created.period_end_date)}.`
        : "Mensalidade renovada."
    );
    await load();
  };

  const plateGroups = useMemo(
    () =>
      groupByKeySorted(rows, (row) => (row.plate || "").trim().toUpperCase() || row.id, (a, b) =>
        String(b.entry_date || "").localeCompare(String(a.entry_date || ""))
      ),
    [rows]
  );

  function renderExitControls(row: ParkingEntryRow) {
    const draft = exitDraft[row.id] ?? defaultExitDraft(row);
    const live = liveTotals[row.id];
    const requireTime = row.billing_mode === "Rotativo";
    const canFinalize =
      Boolean(draft.date) && (!requireTime || Boolean(draft.time?.trim())) && !saving;

    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">
          {row.billing_mode === "Mensal"
            ? "Encerrar período / saída"
            : "Saída / fechar — informe data e hora reais"}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Data saída
            </span>
            <input
              type="date"
              className={glassField(true)}
              value={draft.date}
              onChange={(e) =>
                setExitDraft((d) => ({
                  ...d,
                  [row.id]: { ...draft, date: e.target.value },
                }))
              }
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Hora saída{requireTime ? " *" : ""}
            </span>
            <input
              type="time"
              required={requireTime}
              className={glassField(requireTime)}
              value={draft.time}
              onChange={(e) =>
                setExitDraft((d) => ({
                  ...d,
                  [row.id]: { ...draft, time: e.target.value },
                }))
              }
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!canFinalize}
            onClick={() => void closeEntry(row)}
            title={
              requireTime && !draft.time?.trim()
                ? "Informe a hora de saída"
                : "Finalizar e lançar no DRE"
            }
          >
            Finalizar
          </Button>
        </div>
        {live ? (
          <p className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sm font-medium text-sky-950">
            Estimado agora: {formatCurrency(live.total)}{" "}
            <span className="font-normal text-sky-800">({live.label})</span>
          </p>
        ) : null}
        {row.billing_mode === "Mensal" ? (
          <div className="space-y-1 text-sm text-slate-700">
            <p>
              Vigência: {formatParkingDateBR(row.entry_date)} →{" "}
              {formatParkingDateBR(row.period_end_date)}
            </p>
            <p>
              Próxima cobrança:{" "}
              <strong>{formatParkingDateBR(row.next_charge_date)}</strong>
            </p>
            {isMensalDueForRenewal(row) ? (
              <p className="font-medium text-amber-800">Período vencido — renove a mensalidade.</p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => void renewMensal(row)}
            >
              Renovar próximo período
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (!companyId) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Estacionamento</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rotativo e diária: finalize com data/hora de saída. Mensal: vigência por aniversário e
            renovação do próximo período. Preços em{" "}
            <Link href="/configuracoes/parametros-patio" className="text-brand-700 underline">
              Parâmetros do Pátio
            </Link>
            .
          </p>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {info ? <Alert variant="info">{info}</Alert> : null}
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
              onChange={(next) => {
                const mode = next as ParkingBillingMode;
                setForm((f) => ({
                  ...f,
                  billing_mode: mode,
                  period_end_date:
                    mode === "Mensal"
                      ? calcMensalPeriod(f.entry_date).periodEndDate
                      : f.period_end_date,
                }));
              }}
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
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    entry_date: e.target.value,
                    period_end_date:
                      f.billing_mode === "Mensal"
                        ? calcMensalPeriod(e.target.value).periodEndDate
                        : f.period_end_date,
                  }))
                }
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
            {form.billing_mode === "Mensal" ? (
              <>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Fim da vigência</span>
                  <input
                    type="date"
                    className={glassField(true)}
                    value={form.period_end_date}
                    min={form.entry_date}
                    onChange={(e) => setForm((f) => ({ ...f, period_end_date: e.target.value }))}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Próxima cobrança</span>
                  <input
                    className={glassField(false)}
                    readOnly
                    value={
                      mensalNextCharge
                        ? formatParkingDateBR(mensalNextCharge)
                        : "—"
                    }
                  />
                </label>
              </>
            ) : null}
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
          {form.billing_mode === "Mensal" && mensalNextCharge ? (
            <p className="text-xs text-slate-600">
              Mensalidade por aniversário: de {formatParkingDateBR(form.entry_date)} até{" "}
              {formatParkingDateBR(form.period_end_date)}. Próxima ordem sugerida em{" "}
              {formatParkingDateBR(mensalNextCharge)}.
            </p>
          ) : null}
          <Button type="button" disabled={saving || quotedRate == null} onClick={() => void openEntry()}>
            Abrir ordem de estacionamento
          </Button>
        </section>
      ) : null}

      {!loading && rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Nenhuma ordem ainda.
        </p>
      ) : null}

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => {
          const live = liveTotals[row.id];
          return (
            <li
              key={row.id}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-500">{row.code}</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{row.plate}</p>
                  <p className="mt-1 text-sm text-slate-700">{row.vehicle_type ?? "—"}</p>
                  <p className="mt-2 text-sm text-slate-800">
                    <span className="font-medium text-slate-500">Entrada:</span>{" "}
                    {formatDateTimeBR(row.entry_date, row.entry_time)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{row.billing_mode ?? "Diária"}</p>
                  {row.billing_mode === "Mensal" ? (
                    <p className="mt-1 text-sm text-slate-700">
                      Vigência até {formatParkingDateBR(row.period_end_date)} · Próx.{" "}
                      {formatParkingDateBR(row.next_charge_date)}
                    </p>
                  ) : null}
                  {row.daily_rate != null ? (
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-medium text-slate-500">Valor:</span>{" "}
                      {formatCurrency(Number(row.daily_rate))}{" "}
                      <span className="text-xs text-slate-500">
                        ({rateUnitLabel(row.billing_mode)})
                      </span>
                    </p>
                  ) : null}
                  {row.status === "Aberto" && live ? (
                    <p className="mt-1 text-sm font-semibold text-sky-900">
                      Estimado: {formatCurrency(live.total)} ({live.label})
                    </p>
                  ) : null}
                  {row.total_amount != null ? (
                    <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
                      Total: {formatCurrency(Number(row.total_amount))}
                      {totalBreakdown(row) ? (
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          ({totalBreakdown(row)})
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {row.status !== "Aberto" ? (
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-medium text-slate-500">Saída:</span>{" "}
                      {formatDateTimeBR(row.exit_date, row.exit_time)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant={
                      row.status === "Finalizado"
                        ? "success"
                        : row.status === "Cancelado"
                          ? "danger"
                          : isMensalDueForRenewal(row)
                            ? "warning"
                            : "warning"
                    }
                  >
                    {isMensalDueForRenewal(row) ? "Renovar" : row.status}
                  </Badge>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <Link
                  href={`/operacional/estacionamento/${row.id}/ticket`}
                  className={`text-center ${glassAction("sky", true)}`}
                >
                  Ticket / imprimir
                </Link>
              </div>

              {companyId ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <PatioPaymentProofClip
                    companyId={companyId}
                    entityType="parking_entry"
                    entityId={row.id}
                    code={row.code}
                    canUpload={canEdit}
                  />
                </div>
              ) : null}

              {row.status === "Aberto" && canEdit ? (
                <div className="mt-3 border-t border-slate-100 pt-3">{renderExitControls(row)}</div>
              ) : null}

              {row.status === "Finalizado" &&
              row.billing_mode === "Mensal" &&
              canEdit &&
              row.next_charge_date ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={saving}
                    onClick={() => void renewMensal(row)}
                  >
                    Abrir próximo período ({formatParkingDateBR(row.next_charge_date)})
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="hidden md:block">
        <DataTableScroll stickyFirst>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Código</th>
                <th className="px-3 py-2.5">Placa</th>
                <th className="px-3 py-2.5">Porte</th>
                <th className="px-3 py-2.5">Entrada / período</th>
                <th className="px-3 py-2.5">Saída / fechar</th>
                <th className="px-3 py-2.5">Valor / estimado</th>
                <th className="px-3 py-2.5">Ticket</th>
                <th className="px-3 py-2.5">Comprovante</th>
                <th className="px-3 py-2.5">Total</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <GroupedTableBodies groups={plateGroups} colSpan={10}>
              {(group) =>
                group.rows.map((row, index) => {
                  const live = liveTotals[row.id];
                  return (
                    <tr
                      key={row.id}
                      className={group.multi ? "align-top" : "border-t border-slate-100"}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-medium">{row.code}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900">
                        {index === 0 || !group.multi ? (
                          row.plate
                        ) : (
                          <span className="text-slate-300" aria-hidden>
                            ↳
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">{row.vehicle_type ?? "—"}</td>
                      <td className="px-3 py-3">
                        {formatDateTimeBR(row.entry_date, row.entry_time)}
                        <div className="text-xs text-slate-500">{row.billing_mode ?? "Diária"}</div>
                        {row.billing_mode === "Mensal" ? (
                          <div className="mt-1 text-xs text-slate-600">
                            Até {formatParkingDateBR(row.period_end_date)} · Próx.{" "}
                            {formatParkingDateBR(row.next_charge_date)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        {row.status === "Aberto" && canEdit ? (
                          renderExitControls(row)
                        ) : row.status === "Aberto" ? (
                          <span className="text-slate-500">Aberto</span>
                        ) : (
                          <span>{formatDateTimeBR(row.exit_date, row.exit_time)}</span>
                        )}
                        {row.status === "Finalizado" &&
                        row.billing_mode === "Mensal" &&
                        canEdit &&
                        row.next_charge_date ? (
                          <div className="mt-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={saving}
                              onClick={() => void renewMensal(row)}
                            >
                              Próximo período
                            </Button>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
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
                        {row.status === "Aberto" && live ? (
                          <div className="mt-1 text-xs font-semibold text-sky-800">
                            Est. {formatCurrency(live.total)} ({live.label})
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/operacional/estacionamento/${row.id}/ticket`}
                          className={glassAction("sky", true)}
                        >
                          Ticket
                        </Link>
                      </td>
                      <td className="px-3 py-3">
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
                      <td className="whitespace-nowrap px-3 py-3">
                        {row.total_amount != null
                          ? formatCurrency(Number(row.total_amount))
                          : live
                            ? formatCurrency(live.total)
                            : "—"}
                        {totalBreakdown(row) ? (
                          <div className="text-xs text-slate-500">{totalBreakdown(row)}</div>
                        ) : live ? (
                          <div className="text-xs text-slate-500">{live.label}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={
                            row.status === "Finalizado"
                              ? "success"
                              : row.status === "Cancelado"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {isMensalDueForRenewal(row) ? "Renovar" : row.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })
              }
            </GroupedTableBodies>
            {rows.length === 0 && !loading ? (
              <tbody>
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Nenhuma ordem ainda.
                  </td>
                </tr>
              </tbody>
            ) : null}
          </table>
        </DataTableScroll>
      </div>
    </div>
  );
}
