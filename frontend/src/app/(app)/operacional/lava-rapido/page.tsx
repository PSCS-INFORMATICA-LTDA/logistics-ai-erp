"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useCompany } from "@/lib/company-context";
import { nextCode } from "@/lib/codes";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
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
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR, normalizePlate } from "@/lib/utils";

export default function LavaRapidoPage() {
  const { companyId } = useCompany();
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
    await seedPatioDefaults(supabase, companyId);
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
    if (!form.vehicle_type_id && tRes.rows[0]) {
      const first = tRes.rows.find((r) => allowsWash(r.usage_category));
      if (first) setForm((f) => ({ ...f, vehicle_type_id: first.id }));
    }
    setLoading(false);
  }, [companyId, supabase, form.vehicle_type_id]);

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

  if (!companyId) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Lava-rápido</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ordem própria — valores por porte em{" "}
          <Link href="/configuracoes/parametros-patio" className="text-brand-700 underline">
            Parâmetros do pátio
          </Link>
          .
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading ? <Loading /> : null}

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

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Porte</th>
              <th className="px-3 py-2">Serviço</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{row.code}</td>
                <td className="px-3 py-2">{formatDateBR(row.service_date)}</td>
                <td className="px-3 py-2">{row.plate}</td>
                <td className="px-3 py-2">{row.vehicle_type ?? "—"}</td>
                <td className="px-3 py-2">{row.service_name}</td>
                <td className="px-3 py-2">
                  {row.service_amount != null ? formatCurrency(Number(row.service_amount)) : "—"}
                </td>
                <td className="px-3 py-2">
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
                <td className="px-3 py-2">
                  {row.status === "Aberto" ? (
                    <Button type="button" disabled={saving} onClick={() => void completeService(row)}>
                      Concluir
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
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
