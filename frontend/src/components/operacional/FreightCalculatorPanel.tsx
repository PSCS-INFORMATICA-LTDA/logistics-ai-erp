"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AddressWithCepField } from "@/components/operacional/AddressWithCepField";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ANTT_AXLE_OPTIONS, ANTT_CARGO_TYPES } from "@/lib/antt-freight";
import { buildTollLookupLinks } from "@/lib/freight-toll-links";
import type { FreightTollPlaza } from "@/lib/qualp-freight";
import { billablePerDiemTotal } from "@/lib/freight-per-diem";
import {
  DEFAULT_ROUND_TRIP_FROM_KM,
  estimateKmRevenue,
} from "@/lib/freight-rates";
import { resolveFreightRate, seedFreightRateDefaults } from "@/lib/freight-rates-api";
import {
  DEFAULT_VAN_KM_RATE,
  formatKmRate,
  isTruckCategory,
  resolveQualpAxlesForTolls,
  resolveVanKmRate,
} from "@/lib/transport-van-estimate";
import { glassField } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

type FreightForm = {
  freight_origin_address: string;
  freight_destination_address: string;
  freight_distance_km: string | number;
  freight_toll_amount: string | number;
  freight_toll_count: string | number;
  freight_toll_detail: FreightTollPlaza[] | null;
  freight_antt_cargo_type: string | number;
  freight_antt_axles: string | number;
  freight_antt_composicao_veicular: boolean;
  freight_antt_alto_desempenho: boolean;
  freight_antt_retorno_vazio: boolean;
  freight_antt_minimum: string | number;
  freight_suggested_total: string | number;
  freight_agreed_amount: string | number;
  freight_antt_detail: Record<string, unknown> | null;
  freight_travel_days: string | number;
  freight_per_diem_detail: Array<{
    day: number;
    lodging: number;
    breakfast: number;
    meals: number;
    dinner: number;
    daily_allowance: number;
  }> | null;
  freight_per_diem_total: string | number;
  freight_per_diem_charge_to: string;
  freight_transport_km_rate: string | number;
};

type Props = {
  form: FreightForm;
  set: (key: string, value: unknown) => void;
  onApplyAgreedToServiceAmount?: (value: number) => void;
  mode?: "frete" | "transporte";
  vehicleCategory?: string | null;
  companyId?: string | null;
  serviceDate?: string | null;
};

function updateSuggestedTotal(
  piso: number,
  pedagio: number,
  perDiem: number,
  set: (key: string, value: unknown) => void
) {
  const total = piso + pedagio + perDiem;
  if (total > 0) {
    set("freight_suggested_total", Math.round(total * 100) / 100);
  }
}

export function FreightCalculatorPanel({
  form,
  set,
  onApplyAgreedToServiceAmount,
  mode = "frete",
  vehicleCategory = null,
  companyId = null,
  serviceDate = null,
}: Props) {
  const isFrete = mode === "frete";
  const isTruck = isTruckCategory(vehicleCategory);
  const supabase = useMemo(() => createClient(), []);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [loadingAntt, setLoadingAntt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<string | null>(null);
  const [qualpLink, setQualpLink] = useState<string | null>(null);
  const [qualpActive, setQualpActive] = useState<boolean | null>(null);
  const [masterRatePerKm, setMasterRatePerKm] = useState<number | null>(null);
  const [roundTripFromKm, setRoundTripFromKm] = useState(DEFAULT_ROUND_TRIP_FROM_KM);
  const [masterRateCode, setMasterRateCode] = useState<string | null>(null);
  const [masterRateError, setMasterRateError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/integrations/status");
        if (!response.ok) return;
        const payload = await response.json();
        setQualpActive(payload.plan === "paid_qualp");
      } catch {
        setQualpActive(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const onDate = (serviceDate && String(serviceDate).slice(0, 10)) || new Date().toISOString().slice(0, 10);
    const modality = isFrete ? "Frete" : "Transporte";
    void (async () => {
      await seedFreightRateDefaults(supabase, companyId);
      const resolved = await resolveFreightRate({
        supabase,
        companyId,
        modality,
        vehicleCategory,
        onDate,
      });
      if (cancelled) return;
      if ("error" in resolved) {
        setMasterRateError(resolved.error);
        setMasterRatePerKm(null);
        setMasterRateCode(null);
        return;
      }
      setMasterRateError(null);
      setMasterRatePerKm(resolved.ratePerKm);
      setRoundTripFromKm(resolved.roundTripFromKm);
      setMasterRateCode(resolved.code);
      // Ao mudar categoria/modalidade, aplica a tarifa mestre (override fica no campo amarelo depois).
      set("freight_transport_km_rate", resolved.ratePerKm);
    })();
    return () => {
      cancelled = true;
    };
    // Só reage a company/modalidade/categoria/data — não ao override digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, isFrete, vehicleCategory, serviceDate, supabase]);

  const tolls = Array.isArray(form.freight_toll_detail) ? form.freight_toll_detail : [];
  const piso = Number(form.freight_antt_minimum) || 0;
  const pedagio = Number(form.freight_toll_amount) || 0;
  const perDiem = billablePerDiemTotal(
    Number(form.freight_per_diem_total) || 0,
    form.freight_per_diem_charge_to
  );
  const perDiemRaw = Number(form.freight_per_diem_total) || 0;
  const sugerido = Number(form.freight_suggested_total) || piso + pedagio + perDiem;
  const fechado = Number(form.freight_agreed_amount) || 0;
  const diff = fechado > 0 ? fechado - sugerido : 0;
  const tollCount = Number(form.freight_toll_count) || tolls.length;
  const distanceKm = Number(form.freight_distance_km) || 0;
  const kmRate = resolveVanKmRate(
    form.freight_transport_km_rate ?? masterRatePerKm ?? DEFAULT_VAN_KM_RATE
  );
  const kmEstimate = estimateKmRevenue(distanceKm, kmRate, roundTripFromKm);
  const isOverride =
    masterRatePerKm != null && Math.abs(kmRate - masterRatePerKm) >= 0.001;
  const tollLookupLinks = buildTollLookupLinks(
    String(form.freight_origin_address ?? ""),
    String(form.freight_destination_address ?? "")
  );
  const tollAxles = resolveQualpAxlesForTolls(
    vehicleCategory,
    Number(form.freight_antt_axles) || null
  );

  const calcRouteAndTolls = async () => {
    setLoadingRoute(true);
    setError(null);
    setWarning(null);
    setRouteInfo(null);
    setQualpLink(null);

    try {
      const response = await fetch("/api/freight/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originAddress: form.freight_origin_address,
          destinationAddress: form.freight_destination_address,
          axles: tollAxles,
          cargoTypeId: Number(form.freight_antt_cargo_type) || 5,
          composicaoVeicular: form.freight_antt_composicao_veicular,
          altoDesempenho: form.freight_antt_alto_desempenho,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Erro ao calcular rota e pedágios.");

      const route = payload.route;
      set("freight_distance_km", route.distanceKm);

      if (route.tollSource === "qualp" && route.tolls?.length) {
        set("freight_toll_detail", route.tolls);
        set("freight_toll_count", route.tollCount ?? route.tolls.length);
        set("freight_toll_amount", route.tollTotal ?? 0);
        updateSuggestedTotal(piso, Number(route.tollTotal) || 0, perDiem, set);
      } else if (route.tollSource === "qualp") {
        set("freight_toll_detail", []);
        set("freight_toll_count", 0);
        set("freight_toll_amount", route.tollTotal ?? 0);
        updateSuggestedTotal(piso, Number(route.tollTotal) || 0, perDiem, set);
      }

      if (route.qualpLink) setQualpLink(route.qualpLink);

      const tollLabel =
        route.tollSource === "qualp"
          ? ` · ${route.tollCount ?? 0} praça(s) · pedágio ${formatCurrency(route.tollTotal ?? 0)}`
          : "";

      setRouteInfo(
        `${route.distanceKm} km · ~${route.durationMinutes} min · ${route.provider}${tollLabel}`
      );

      if (payload.warning || (Array.isArray(payload.geocodeWarnings) && payload.geocodeWarnings.length > 0)) {
        const parts = [
          ...(Array.isArray(payload.geocodeWarnings) ? payload.geocodeWarnings : []),
          payload.warning,
        ].filter(Boolean);
        setWarning(parts.join(" "));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao calcular rota e pedágios.");
    } finally {
      setLoadingRoute(false);
    }
  };

  const calcAntt = async () => {
    if (!isTruck) {
      setError("Piso ANTT aplica-se apenas a caminhão (frete de carga). Para van, use a referência de transporte abaixo.");
      return;
    }
    const distanceKm = Number(form.freight_distance_km);
    if (!distanceKm || distanceKm < 1) {
      setError("Informe ou calcule a distância em km antes do piso ANTT.");
      return;
    }

    setLoadingAntt(true);
    setError(null);
    try {
      const response = await fetch("/api/freight/antt-minimum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distanceKm,
          cargoTypeId: Number(form.freight_antt_cargo_type) || 5,
          axles: Number(form.freight_antt_axles) || 5,
          composicaoVeicular: form.freight_antt_composicao_veicular,
          altoDesempenho: form.freight_antt_alto_desempenho,
          retornoVazio: form.freight_antt_retorno_vazio,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Erro no cálculo ANTT.");

      const result = payload.result;
      const toll = Number(form.freight_toll_amount) || 0;
      const suggested = Math.round((result.pisoMinimo + toll + perDiem) * 100) / 100;

      set("freight_antt_minimum", result.pisoMinimo);
      set("freight_suggested_total", suggested);
      set("freight_antt_detail", result);
      if (!form.freight_agreed_amount) {
        set("freight_agreed_amount", suggested);
        onApplyAgreedToServiceAmount?.(suggested);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no cálculo ANTT.");
    } finally {
      setLoadingAntt(false);
    }
  };

  const applyKmReference = () => {
    const suggested = Math.round((kmEstimate.amount + pedagio + perDiem) * 100) / 100;
    set("freight_suggested_total", suggested);
    set("freight_agreed_amount", suggested);
    onApplyAgreedToServiceAmount?.(suggested);
  };

  const resetToMasterRate = () => {
    if (masterRatePerKm != null) set("freight_transport_km_rate", masterRatePerKm);
  };

  const applySuggested = () => {
    set("freight_agreed_amount", sugerido);
    onApplyAgreedToServiceAmount?.(sugerido);
  };

  return (
    <div className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 sm:col-span-2">
      <div>
        <p className="text-sm font-medium text-slate-800">
          {isFrete ? "Cálculo de frete (ANTT)" : "Rota e pedágios"}
        </p>
        <p className="text-xs text-slate-500">
          {isFrete ? (
            <>
              Ponto A → Ponto B, pedágios detalhados, piso mínimo legal e valor fechado. Informe{" "}
              <strong>rua, cidade e UF</strong> ou use <strong>Consultar CEP</strong>. Base:{" "}
              <a
                href="https://calculadorafrete.antt.gov.br/"
                target="_blank"
                rel="noreferrer"
                className="text-brand-700 underline"
              >
                calculadora oficial ANTT
              </a>
              .
            </>
          ) : (
            <>
              Ponto A → Ponto B com distância e pedágios para transporte de passageiros. Informe o
              endereço completo ou use <strong>Consultar CEP</strong> para preencher automaticamente.
            </>
          )}
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {warning && (
        <Alert variant="warning">
          {warning}{" "}
          {qualpActive === false && (
            <Link href="/configuracoes/integracoes" className="font-medium underline">
              Ver integrações
            </Link>
          )}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <AddressWithCepField
          label="Ponto A — origem"
          address={String(form.freight_origin_address ?? "")}
          placeholder="Rua, número, cidade, UF (ex.: Rua X, Itapecerica da Serra, SP)"
          onAddressChange={(value) => set("freight_origin_address", value)}
          required
        />
        <AddressWithCepField
          label="Ponto B — destino"
          address={String(form.freight_destination_address ?? "")}
          placeholder="Rua, número, cidade, UF (ex.: Centro, Vila Velha, ES)"
          onAddressChange={(value) => set("freight_destination_address", value)}
          required
        />

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingRoute}
            onClick={() => void calcRouteAndTolls()}
          >
            {loadingRoute ? "Calculando..." : "Calcular rota e pedágios"}
          </Button>
          {routeInfo && <span className="text-sm text-green-700">{routeInfo}</span>}
          {qualpLink && (
            <a
              href={qualpLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-700 underline"
            >
              Ver rota no QualP
            </a>
          )}
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Distância (km)</span>
          <input
            type="number"
            min={1}
            step="0.01"
            className={glassField(false)}
            value={String(form.freight_distance_km ?? "")}
            onChange={(e) => set("freight_distance_km", e.target.value)}
          />
          <span className="text-xs text-slate-500">Preenchida pelo cálculo de rota.</span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">
            Pedágio total (R$) — ajustável para negociação
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            className={glassField(true)}
            required
            value={String(form.freight_toll_amount ?? "")}
            onChange={(e) => {
              set("freight_toll_amount", e.target.value);
              const toll = Number(e.target.value) || 0;
              updateSuggestedTotal(piso, toll, perDiem, set);
            }}
          />
        </label>

        {isFrete && (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Tipo de carga (ANTT)</span>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={String(form.freight_antt_cargo_type ?? 5)}
                onChange={(e) => set("freight_antt_cargo_type", Number(e.target.value))}
              >
                {ANTT_CARGO_TYPES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            {isTruck ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Nº de eixos (caminhão)</span>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={String(form.freight_antt_axles ?? 5)}
                  onChange={(e) => set("freight_antt_axles", Number(e.target.value))}
                >
                  {ANTT_AXLE_OPTIONS.map((axle) => (
                    <option key={axle} value={axle}>
                      {axle}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Eixos e piso ANTT são apenas para <strong>caminhão</strong>. Van/ônibus não entram na
                tabela ANTT de carga.
              </div>
            )}

            <label className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                checked={Boolean(form.freight_antt_composicao_veicular)}
                onChange={(e) => set("freight_antt_composicao_veicular", e.target.checked)}
              />
              <span className="text-sm text-slate-700">Composição veicular (Tabela A/C)</span>
            </label>

            <label className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                checked={Boolean(form.freight_antt_alto_desempenho)}
                onChange={(e) => set("freight_antt_alto_desempenho", e.target.checked)}
              />
              <span className="text-sm text-slate-700">Alto desempenho</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(form.freight_antt_retorno_vazio)}
                onChange={(e) => set("freight_antt_retorno_vazio", e.target.checked)}
              />
              <span className="text-sm text-slate-700">Retorno vazio (×1,92)</span>
            </label>
          </>
        )}

        <div className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/50 p-3 sm:col-span-2">
          <div>
            <p className="text-sm font-medium text-slate-800">Tarifa da empresa (R$/km)</p>
            <p className="text-xs text-slate-500">
              Preço-base em{" "}
              <Link href="/configuracoes/parametros-frete" className="text-brand-700 underline">
                Parâmetros de frete
              </Link>
              . Amarelo = override só desta OS (recalcula na hora).
            </p>
          </div>

          {masterRateError ? <Alert variant="warning">{masterRateError}</Alert> : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Tarifa mestre</span>
              <input
                className={glassField(false)}
                readOnly
                value={
                  masterRatePerKm != null
                    ? `${formatKmRate(masterRatePerKm)}${masterRateCode ? ` (${masterRateCode})` : ""}`
                    : "— sem cadastro —"
                }
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Valor por km (R$) desta OS</span>
              <input
                type="number"
                min={0.01}
                step="0.01"
                className={glassField(true)}
                value={String(form.freight_transport_km_rate ?? masterRatePerKm ?? "")}
                onChange={(e) => set("freight_transport_km_rate", e.target.value)}
              />
              <span className="text-xs text-slate-500">
                {isOverride
                  ? "Override ativo (diferente do cadastro mestre)."
                  : "Usando tarifa do cadastro mestre."}
              </span>
            </label>
            <div className="flex flex-col justify-end gap-1 text-sm">
              <p>
                Distância rota: <strong>{distanceKm || "—"} km</strong>
              </p>
              <p>
                Km cobrados:{" "}
                <strong>
                  {distanceKm > 0 ? `${kmEstimate.billableKm} km` : "—"}
                  {kmEstimate.isRoundTrip ? " (ida e volta)" : ""}
                </strong>
              </p>
              <p className="text-xs text-slate-500">
                Regra ida/volta a partir de {roundTripFromKm} km
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 text-sm">
            <p>
              Referência km:{" "}
              <strong>{distanceKm > 0 ? formatCurrency(kmEstimate.amount) : "—"}</strong>
              <span className="text-xs text-slate-500">
                {" "}
                + pedágio {formatCurrency(pedagio)}
                {perDiem > 0 ? ` + despesas ${formatCurrency(perDiem)}` : ""}
              </span>
            </p>
            {isOverride && masterRatePerKm != null ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetToMasterRate}>
                Voltar à tarifa mestre
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={distanceKm <= 0 || kmEstimate.amount <= 0}
              onClick={applyKmReference}
            >
              {isFrete ? "Usar tarifa km + pedágio no sugerido" : "Usar referência + pedágio na OS"}
            </Button>
          </div>
        </div>
      </div>

      {tollLookupLinks.length > 0 && qualpActive !== true && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-800">Consultar pedágios manualmente (gratuito)</p>
          <p className="text-xs text-slate-500">
            Waze e Google não oferecem API gratuita com valor por praça. Use os links abaixo com os
            endereços A e B já informados e copie o total para o campo de pedágio.
          </p>
          <ul className="space-y-2">
            {tollLookupLinks.map((link) => (
              <li key={link.href + link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-700 underline"
                >
                  {link.label}
                </a>
                {link.hint && <p className="text-xs text-slate-500">{link.hint}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(tolls.length > 0 || tollCount > 0) && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">
              Pedágios na rota — {tollCount} praça{tollCount === 1 ? "" : "s"}
            </p>
            <p className="text-sm font-semibold text-slate-900">
              Total: {formatCurrency(pedagio)}
            </p>
          </div>
          {tolls.length > 0 ? (
            <div className="overflow-x-auto rounded border border-amber-100 bg-white">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">#</th>
                    <th className="px-2 py-1.5 font-medium">Praça</th>
                    <th className="px-2 py-1.5 font-medium">Local</th>
                    <th className="px-2 py-1.5 font-medium text-right">Valor</th>
                    <th className="px-2 py-1.5 font-medium text-right">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {tolls.map((plaza) => (
                    <tr key={`${plaza.order}-${plaza.name}`} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-500">{plaza.order}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-800">{plaza.name}</td>
                      <td className="px-2 py-1.5 text-slate-600">
                        {[plaza.city, plaza.state].filter(Boolean).join(" / ") || "—"}
                        {plaza.concessionaire ? ` · ${plaza.concessionaire}` : ""}
                      </td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(plaza.amount)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-600">
                        {plaza.tagAmount != null ? formatCurrency(plaza.tagAmount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-600">
              Nenhuma praça listada — ajuste o total de pedágio manualmente se necessário.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Rafael pode alterar o pedágio total acima para refletir desconto ou acordo com o cliente.
          </p>
        </div>
      )}

      {isFrete && isTruck && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={loadingAntt} onClick={() => void calcAntt()}>
              {loadingAntt ? "Calculando piso..." : "Calcular piso mínimo ANTT"}
            </Button>
            <Button type="button" variant="secondary" disabled={sugerido <= 0} onClick={applySuggested}>
              Usar valor sugerido
            </Button>
          </div>

          <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm sm:grid-cols-2">
            <p>
              Piso mínimo ANTT: <strong>{piso > 0 ? formatCurrency(piso) : "—"}</strong>
            </p>
            <p>
              Sugerido (piso + pedágio + despesas viagem):{" "}
              <strong>{sugerido > 0 ? formatCurrency(sugerido) : "—"}</strong>
            </p>
            {perDiemRaw > 0 && (
              <p>
                Despesas de viagem (repasse cliente): <strong>{formatCurrency(perDiem)}</strong>
                {perDiemRaw !== perDiem && (
                  <span className="text-xs text-slate-500">
                    {" "}
                    · total GRX {formatCurrency(perDiemRaw)} (custo interno)
                  </span>
                )}
              </p>
            )}
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Valor fechado com o cliente (R$)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={String(form.freight_agreed_amount ?? "")}
                onChange={(e) => {
                  set("freight_agreed_amount", e.target.value);
                  const val = Number(e.target.value);
                  if (!Number.isNaN(val)) onApplyAgreedToServiceAmount?.(val);
                }}
              />
            </label>
            {fechado > 0 && sugerido > 0 && (
              <p className={`sm:col-span-2 ${diff < 0 ? "text-red-700" : "text-green-700"}`}>
                {diff < 0
                  ? `Atenção: ${formatCurrency(Math.abs(diff))} abaixo do sugerido (piso + pedágio).`
                  : diff > 0
                    ? `${formatCurrency(diff)} acima do sugerido — margem adicional.`
                    : "Valor igual ao sugerido."}
              </p>
            )}
          </div>
        </>
      )}

      <p className="text-xs text-slate-500">
        {qualpActive
          ? "Pedágios automáticos via QualP ativos. Confira sempre na calculadora ANTT antes de fechar contrato."
          : isFrete
            ? (
              <>
                Modo gratuito: distância (OSRM), piso ANTT local e pedágio manual. Para automatizar pedágios,{" "}
                <Link href="/configuracoes/integracoes" className="text-brand-700 underline">
                  ative o QualP
                </Link>{" "}
                quando a demanda justificar.
              </>
            )
            : (
              <>
                Modo gratuito: distância (OSRM) e pedágio manual. Use os links acima para consultar
                pedágios no Google Maps ou QualP.{" "}
                <Link href="/configuracoes/integracoes" className="text-brand-700 underline">
                  Integrações
                </Link>{" "}
                para automatizar com QualP API.
              </>
            )}
      </p>
    </div>
  );
}
