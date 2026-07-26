"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GroupedTableBodies } from "@/components/ui/GroupedTableBodies";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { nextCode } from "@/lib/codes";
import { glassAction, glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { groupByKeySorted } from "@/lib/table-row-groups";
import {
  allowsWash,
  CAR_WASH_SERVICE_NAMES,
  PATIO_PAYMENT_METHODS,
  type CarWashServiceRow,
  type PatioVehicleType,
} from "@/lib/patio";
import {
  listPatioVehicleTypes,
  postCarWashRevenue,
  resolvePatioPrice,
  seedPatioDefaults,
} from "@/lib/patio-api";
import { PatioPaymentProofClip } from "@/components/operacional/PatioPaymentProofClip";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR, normalizePlate } from "@/lib/utils";

export default function LavaRapidoPage() {
  const { companyId } = useCompany();
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("operacional.lava-rapido");
  const supabase = useMemo(() => createClient(), []);
  const [types, setTypes] = useState<PatioVehicleType[]>([]);
  const [rows, setRows] = useState<CarWashServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [quotedPrice, setQuotedPrice] = useState<number | null>(null);

  const [form, setForm] = useState<{
    plate: string;
    brand: string;
    model: string;
    vehicle_type_id: string;
    client_name: string;
    phone: string;
    service_date: string;
    service_name: string;
    payment_method: string;
    attendant: string;
    notes: string;
  }>({
    plate: "",
    brand: "",
    model: "",
    vehicle_type_id: "",
    client_name: "",
    phone: "",
    service_date: new Date().toISOString().slice(0, 10),
    service_name: CAR_WASH_SERVICE_NAMES[0],
    payment_method: "Pix",
    attendant: "",
    notes: "",
  });

  const washTypes = types.filter((t) => t.is_active && allowsWash(t.usage_category));

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.race([
        seedPatioDefaults(supabase, companyId),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 6000)),
      ]);
      const [tRes, wRes] = await Promise.all([
        listPatioVehicleTypes(supabase, companyId, true),
        supabase
          .from("car_wash_services")
          .select("*")
          .eq("company_id", companyId)
          .order("service_date", { ascending: false })
          .limit(100),
      ]);
      if (tRes.error || wRes.error) setError(tRes.error ?? wRes.error?.message ?? null);
      setTypes(tRes.rows);
      setRows((wRes.data as CarWashServiceRow[]) ?? []);
      setForm((f) => {
        if (f.vehicle_type_id) return f;
        const first = tRes.rows.find((r) => allowsWash(r.usage_category));
        return first ? { ...f, vehicle_type_id: first.id } : f;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o lava-rápido.");
    } finally {
      setLoading(false);
    }
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!companyId || !form.vehicle_type_id || !form.service_name || !form.service_date) {
      setQuotedPrice(null);
      return;
    }
    let cancelled = false;
    void resolvePatioPrice({
      supabase,
      companyId,
      modality: "Lava Rápido",
      vehicleTypeId: form.vehicle_type_id,
      serviceName: form.service_name,
      onDate: form.service_date,
    }).then((result) => {
      if (cancelled) return;
      if ("error" in result) setQuotedPrice(null);
      else setQuotedPrice(result.price);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, form.vehicle_type_id, form.service_name, form.service_date, supabase]);

  const openService = async () => {
    if (!companyId) return;
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para abrir ordens.");
      return;
    }
    const type = washTypes.find((t) => t.id === form.vehicle_type_id);
    if (!form.plate.trim() || !type) {
      setError("Informe placa e porte.");
      return;
    }
    const price = await resolvePatioPrice({
      supabase,
      companyId,
      modality: "Lava Rápido",
      vehicleTypeId: type.id,
      serviceName: form.service_name,
      onDate: form.service_date,
    });
    if ("error" in price) {
      setError(price.error);
      return;
    }

    setSaving(true);
    setError(null);
    const code = await nextCode("car_wash_services", companyId, "LAV");
    const { error: insertError } = await supabase.from("car_wash_services").insert({
      company_id: companyId,
      code,
      service_date: form.service_date,
      plate: normalizePlate(form.plate),
      brand: form.brand || null,
      model: form.model || null,
      vehicle_type_id: type.id,
      vehicle_type: type.name,
      client_name: form.client_name || null,
      phone: form.phone || null,
      service_name: form.service_name,
      service_amount: price.price,
      status: "Aberto",
      entry_date: form.service_date,
      attendant: form.attendant || null,
      payment_method: form.payment_method || null,
      notes: form.notes || null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
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

  const completeService = async (row: CarWashServiceRow) => {
    if (!companyId) return;
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para concluir.");
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: updError } = await supabase
      .from("car_wash_services")
      .update({
        status: "Concluido",
        exit_date: row.service_date,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (updError || !data) {
      setSaving(false);
      setError(updError?.message ?? "Falha ao concluir.");
      return;
    }
    const posted = await postCarWashRevenue({
      supabase,
      companyId,
      row: data as CarWashServiceRow,
    });
    setSaving(false);
    if (posted.error) setError(posted.error);
    await load();
  };

  const plateGroups = useMemo(
    () =>
      groupByKeySorted(rows, (row) => (row.plate || "").trim().toUpperCase() || row.id, (a, b) =>
        String(b.service_date || "").localeCompare(String(a.service_date || ""))
      ),
    [rows]
  );

  if (!companyId) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Lava-rápido</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ordem própria — valores por porte em{" "}
          <Link href="/configuracoes/parametros-patio" className="text-brand-700 underline">
            Parâmetros do Pátio
          </Link>
          .
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {!canEdit ? (
        <Alert variant="info">
          Modo visualização: você pode consultar as ordens, mas não abrir nem concluir serviços.
        </Alert>
      ) : null}
      {loading ? <Loading /> : null}

      {canEdit ? (
      <section className={`space-y-4 ${glassFilterPanel()}`}>
        <h2 className="text-sm font-semibold text-slate-900">Nova ordem de lava</h2>
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
            options={washTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
          <GlassSelect
            label="Serviço"
            required
            value={form.service_name}
            onChange={(next) => setForm((f) => ({ ...f, service_name: next }))}
            options={CAR_WASH_SERVICE_NAMES.map((s) => ({ value: s, label: s }))}
          />
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Data do serviço</span>
            <input
              type="date"
              className={glassField(true)}
              value={form.service_date}
              onChange={(e) => setForm((f) => ({ ...f, service_date: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Valor (tabela)</span>
            <input
              className={glassField(false)}
              readOnly
              value={quotedPrice != null ? formatCurrency(quotedPrice) : "— sem preço —"}
            />
          </label>
          <GlassSelect
            label="Pagamento"
            value={form.payment_method}
            onChange={(next) => setForm((f) => ({ ...f, payment_method: next }))}
            options={PATIO_PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
          />
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
            <span className="text-sm font-medium text-slate-700">Responsável</span>
            <input
              className={glassField(false)}
              value={form.attendant}
              onChange={(e) => setForm((f) => ({ ...f, attendant: e.target.value }))}
            />
          </label>
        </div>
        <Button type="button" disabled={saving || quotedPrice == null} onClick={() => void openService()}>
          Abrir ordem de lava-rápido
        </Button>
      </section>
      ) : null}

      {!loading && rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Nenhuma ordem ainda.
        </p>
      ) : null}

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-500">{row.code}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{row.plate}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {formatDateBR(row.service_date)} · {row.vehicle_type ?? "—"}
                </p>
                <p className="mt-2 text-sm leading-snug break-words text-slate-800">
                  {row.service_name}
                </p>
                {row.service_amount != null ? (
                  <p className="mt-2 text-base font-bold tabular-nums text-slate-900">
                    {formatCurrency(Number(row.service_amount))}
                  </p>
                ) : null}
              </div>
              <Badge
                variant={
                  row.status === "Concluido"
                    ? "success"
                    : row.status === "Cancelado"
                      ? "danger"
                      : "warning"
                }
              >
                {row.status}
              </Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <Link
                href={`/operacional/lava-rapido/${row.id}/ticket`}
                className={`text-center ${glassAction("sky", true)}`}
              >
                Ticket / imprimir
              </Link>
              {row.status === "Aberto" && canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void completeService(row)}
                >
                  Concluir
                </Button>
              ) : null}
            </div>

            {companyId ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <PatioPaymentProofClip
                  companyId={companyId}
                  entityType="car_wash_service"
                  entityId={row.id}
                  code={row.code}
                  canUpload={canEdit}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
      <DataTableScroll stickyFirst stickyLast compact>
        <table className="w-full text-left text-[11px] leading-snug sm:text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sm:text-xs">
            <tr>
              <th className="px-1.5 py-2">Código</th>
              <th className="hidden px-1.5 py-2 md:table-cell">Data</th>
              <th className="px-1.5 py-2">Placa</th>
              <th className="hidden px-1.5 py-2 md:table-cell">Porte</th>
              <th className="px-1.5 py-2">Serviço</th>
              <th className="hidden px-1.5 py-2 lg:table-cell">Valor</th>
              <th className="hidden px-1.5 py-2 xl:table-cell">Comprovante</th>
              <th className="px-1.5 py-2">Status</th>
              <th className="px-1.5 py-2">Ticket</th>
              <th className="px-1.5 py-2" />
            </tr>
          </thead>
          <GroupedTableBodies groups={plateGroups} colSpan={10}>
            {(group) =>
              group.rows.map((row, index) => (
                <tr key={row.id} className={group.multi ? "align-top" : "border-t border-slate-100"}>
                  <td className="whitespace-nowrap px-1.5 py-1.5 font-medium">{row.code}</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1.5 md:table-cell">
                    {formatDateBR(row.service_date)}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 font-medium text-slate-900">
                    {index === 0 || !group.multi ? row.plate : (
                      <span className="text-slate-300" aria-hidden>
                        ↳
                      </span>
                    )}
                  </td>
                  <td className="hidden px-1.5 py-1.5 md:table-cell">{row.vehicle_type ?? "—"}</td>
                  <td
                    className="max-w-[7rem] truncate px-1.5 py-1.5 sm:max-w-[10rem]"
                    title={row.service_name || undefined}
                  >
                    {row.service_name}
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1.5 lg:table-cell">
                    {row.service_amount != null ? formatCurrency(Number(row.service_amount)) : "—"}
                  </td>
                  <td className="hidden px-1.5 py-1.5 xl:table-cell">
                    {companyId ? (
                      <PatioPaymentProofClip
                        companyId={companyId}
                        entityType="car_wash_service"
                        entityId={row.id}
                        code={row.code}
                        canUpload={canEdit}
                      />
                    ) : null}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <Badge
                      variant={
                        row.status === "Concluido"
                          ? "success"
                          : row.status === "Cancelado"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-1.5 py-1.5">
                    <Link
                      href={`/operacional/lava-rapido/${row.id}/ticket`}
                      className={glassAction("sky", true)}
                    >
                      Ticket
                    </Link>
                  </td>
                  <td className="px-1.5 py-1.5">
                    {row.status === "Aberto" && canEdit ? (
                      <Button
                        type="button"
                        size="sm"
                        className="action-icon-btn"
                        disabled={saving}
                        title="Concluir"
                        onClick={() => void completeService(row)}
                      >
                        <span className="sm:hidden">OK</span>
                        <span className="hidden sm:inline">Concluir</span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
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
