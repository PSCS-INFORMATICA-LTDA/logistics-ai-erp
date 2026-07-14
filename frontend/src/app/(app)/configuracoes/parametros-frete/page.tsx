"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useCompany } from "@/lib/company-context";
import { nextCode } from "@/lib/codes";
import {
  DEFAULT_ROUND_TRIP_FROM_KM,
  FREIGHT_RATE_MODALITIES,
  FREIGHT_RATE_VEHICLE_CATEGORIES,
  type FreightRateRow,
} from "@/lib/freight-rates";
import { listFreightRates, seedFreightRateDefaults } from "@/lib/freight-rates-api";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR } from "@/lib/utils";
import { formatKmRate } from "@/lib/transport-van-estimate";

export default function ParametrosFretePage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<FreightRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    modality: "Frete",
    vehicle_category: "Caminhao",
    rate_per_km: "7",
    round_trip_from_km: String(DEFAULT_ROUND_TRIP_FROM_KM),
    valid_from: new Date().toISOString().slice(0, 10),
    valid_until: "",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    await seedFreightRateDefaults(supabase, companyId);
    const result = await listFreightRates(supabase, companyId);
    if (result.error) setError(result.error);
    setRows(result.rows);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!companyId) return;
    const rate = Number(form.rate_per_km);
    const roundTrip = Number(form.round_trip_from_km);
    if (!rate || rate <= 0) {
      setError("Informe o valor por km.");
      return;
    }
    if (form.valid_until && form.valid_until < form.valid_from) {
      setError("Data fim não pode ser anterior ao início.");
      return;
    }
    setSaving(true);
    setError(null);
    const code = await nextCode("freight_rate_tables", companyId, "TF");
    const { error: insertError } = await supabase.from("freight_rate_tables").insert({
      company_id: companyId,
      code,
      modality: form.modality,
      vehicle_category: form.vehicle_category,
      rate_per_km: rate,
      round_trip_from_km: Number.isFinite(roundTrip) ? roundTrip : DEFAULT_ROUND_TRIP_FROM_KM,
      valid_from: form.valid_from,
      valid_until: form.valid_until || null,
      status: "Ativo",
      notes: form.notes || null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setMsg("Tarifa cadastrada (nova vigência).");
    setForm((f) => ({ ...f, rate_per_km: "", notes: "", valid_until: "" }));
    await load();
  };

  const deactivate = async (id: string) => {
    if (!confirm("Inativar esta tarifa?")) return;
    const { error: updError } = await supabase
      .from("freight_rate_tables")
      .update({ status: "Inativo" })
      .eq("id", id);
    if (updError) setError(updError.message);
    else await load();
  };

  if (!companyId) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Parâmetros de frete</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cadastro mestre de R$/km por modalidade e categoria de veículo. A OS usa esta tarifa
          automaticamente; override pontual fica no formulário (amarelo).
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="info">{msg}</Alert> : null}
      {loading ? <Loading /> : null}

      <section className={`space-y-4 ${glassFilterPanel()}`}>
        <h2 className="text-sm font-semibold text-slate-900">Nova tarifa (vigência)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <GlassSelect
            label="Modalidade"
            required
            value={form.modality}
            onChange={(next) => setForm((f) => ({ ...f, modality: next }))}
            options={FREIGHT_RATE_MODALITIES.map((m) => ({ value: m, label: m }))}
          />
          <GlassSelect
            label="Categoria do veículo"
            required
            value={form.vehicle_category}
            onChange={(next) => setForm((f) => ({ ...f, vehicle_category: next }))}
            options={FREIGHT_RATE_VEHICLE_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Valor por km (R$)</span>
            <input
              type="number"
              min={0.01}
              step="0.01"
              className={glassField(true)}
              value={form.rate_per_km}
              onChange={(e) => setForm((f) => ({ ...f, rate_per_km: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Ida e volta a partir de (km)</span>
            <input
              type="number"
              min={0}
              step="1"
              className={glassField(true)}
              value={form.round_trip_from_km}
              onChange={(e) => setForm((f) => ({ ...f, round_trip_from_km: e.target.value }))}
            />
            <span className="text-xs text-slate-500">
              Ex.: 500 — acima disso a OS cobra km × 2 (ida e volta).
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Vigência desde</span>
            <input
              type="date"
              className={glassField(true)}
              value={form.valid_from}
              onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Data fim</span>
            <input
              type="date"
              className={glassField(false)}
              value={form.valid_until}
              onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
            />
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Observações</span>
            <input
              className={glassField(false)}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
        </div>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          + Nova tarifa
        </Button>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Cód.</th>
              <th className="px-3 py-2">Modalidade</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">R$/km</th>
              <th className="px-3 py-2">Ida/volta ≥</th>
              <th className="px-3 py-2">Desde</th>
              <th className="px-3 py-2">Data fim</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{row.code}</td>
                <td className="px-3 py-2">{row.modality}</td>
                <td className="px-3 py-2">{row.vehicle_category}</td>
                <td className="px-3 py-2 font-medium">{formatKmRate(Number(row.rate_per_km))}</td>
                <td className="px-3 py-2">{Number(row.round_trip_from_km)} km</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateBR(row.valid_from)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.valid_until ? formatDateBR(row.valid_until) : "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={row.status === "Ativo" ? "success" : "default"}>{row.status}</Badge>
                </td>
                <td className="px-3 py-2">
                  {row.status === "Ativo" ? (
                    <Button type="button" variant="ghost" onClick={() => void deactivate(row.id)}>
                      Inativar
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  Nenhuma tarifa. Rode o SQL apply-043 ou cadastre acima.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500">
          Exemplo: caminhão a {formatCurrency(7)}/km — rota de 600 km cobra 1.200 km (ida e volta).
        </p>
      </section>
    </div>
  );
}
