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
import { companyDisplayName } from "@/lib/company-logo";
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
import {
  getPatioSettings,
  listWashHistoryForPlate,
} from "@/lib/patio-settings-api";
import {
  buildSmsShareHref,
  buildWashReadyWhatsApp,
  canUseDeviceSms,
  launchShareHref,
  washReadyWhatsAppHref,
} from "@/lib/wash-notify";
import {
  computeWashLoyaltyProgress,
  washLoyaltyLabel,
  type PatioWashLoyaltySettings,
  type WashLoyaltyProgress,
} from "@/lib/wash-loyalty";
import { copyTextToClipboardSync } from "@/lib/service-order-proposal";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR, normalizePlate } from "@/lib/utils";

function statusBadgeVariant(status: string): "success" | "danger" | "warning" | "default" {
  if (status === "Concluido") return "success";
  if (status === "Cancelado") return "danger";
  if (status === "Pronto") return "default";
  return "warning";
}

export default function LavaRapidoPage() {
  const { companyId, company } = useCompany();
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("operacional.lava-rapido");
  const supabase = useMemo(() => createClient(), []);
  const companyName = companyDisplayName(company);
  const [types, setTypes] = useState<PatioVehicleType[]>([]);
  const [rows, setRows] = useState<CarWashServiceRow[]>([]);
  const [loyaltySettings, setLoyaltySettings] = useState<PatioWashLoyaltySettings | null>(null);
  const [plateLoyalty, setPlateLoyalty] = useState<WashLoyaltyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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
      const [tRes, wRes, settingsRes] = await Promise.all([
        listPatioVehicleTypes(supabase, companyId, true),
        supabase
          .from("car_wash_services")
          .select("*")
          .eq("company_id", companyId)
          .order("service_date", { ascending: false })
          .limit(100),
        getPatioSettings(supabase, companyId),
      ]);
      if (tRes.error || wRes.error) setError(tRes.error ?? wRes.error?.message ?? null);
      if (settingsRes.error && /apply-063/i.test(settingsRes.error)) {
        setInfo(settingsRes.error);
      }
      setTypes(tRes.rows);
      setRows((wRes.data as CarWashServiceRow[]) ?? []);
      setLoyaltySettings(settingsRes.settings);
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

  useEffect(() => {
    if (!companyId || !loyaltySettings || !form.plate.trim()) {
      setPlateLoyalty(null);
      return;
    }
    let cancelled = false;
    const plate = normalizePlate(form.plate);
    void listWashHistoryForPlate(supabase, companyId, plate).then((res) => {
      if (cancelled) return;
      setPlateLoyalty(computeWashLoyaltyProgress(res.rows, loyaltySettings));
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, form.plate, loyaltySettings, supabase, rows]);

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

    const plate = normalizePlate(form.plate);
    const history = await listWashHistoryForPlate(supabase, companyId, plate);
    const progress = loyaltySettings
      ? computeWashLoyaltyProgress(history.rows, loyaltySettings)
      : null;
    let useLoyalty = false;
    if (progress?.enabled && progress.availableFree > 0) {
      useLoyalty = window.confirm(
        `Placa ${plate} tem ${progress.availableFree} lavagem(ns) grátis (fidelidade a cada ${progress.everyN}).\n\nUsar 1 lavagem grátis nesta ordem?`
      );
    }

    setSaving(true);
    setError(null);
    setInfo(null);
    const code = await nextCode("car_wash_services", companyId, "LAV");
    const { error: insertError } = await supabase.from("car_wash_services").insert({
      company_id: companyId,
      code,
      service_date: form.service_date,
      plate,
      brand: form.brand || null,
      model: form.model || null,
      vehicle_type_id: type.id,
      vehicle_type: type.name,
      client_name: form.client_name || null,
      phone: form.phone || null,
      service_name: form.service_name,
      service_amount: useLoyalty ? 0 : price.price,
      is_loyalty_reward: useLoyalty,
      status: "Aberto",
      entry_date: form.service_date,
      attendant: form.attendant || null,
      payment_method: useLoyalty ? "Fidelidade" : form.payment_method || null,
      notes: form.notes || null,
    });
    setSaving(false);
    if (insertError) {
      if (/is_loyalty_reward|Pronto/i.test(insertError.message)) {
        setError(
          "Banco desatualizado. Rode frontend/scripts/apply-063-car-wash-ready-loyalty.sql no Supabase."
        );
      } else {
        setError(insertError.message);
      }
      return;
    }
    if (useLoyalty) setInfo(`Ordem ${code}: lavagem grátis (fidelidade) aplicada.`);
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

  const persistReadyStatus = async (row: CarWashServiceRow) => {
    if (!companyId) return;
    const { error: updError } = await supabase
      .from("car_wash_services")
      .update({
        status: row.status === "Aberto" ? "Pronto" : row.status,
        ready_notified_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updError) {
      if (/Pronto|ready_notified/i.test(updError.message)) {
        setError(
          "Aviso aberto, mas o status não gravou. Rode apply-063-car-wash-ready-loyalty.sql no Supabase."
        );
      } else {
        setError(`Aviso aberto, mas falhou ao gravar status: ${updError.message}`);
      }
      return;
    }
    await load();
  };

  const markReady = (row: CarWashServiceRow, channel: "whatsapp" | "sms") => {
    if (!companyId || !canEdit) return;
    if (!row.phone?.trim()) {
      setError("Informe o telefone do cliente na ordem (DDD + número) para avisar.");
      return;
    }

    const share = buildWashReadyWhatsApp({
      companyName,
      plate: row.plate,
      phone: row.phone,
      clientName: row.client_name,
      serviceName: row.service_name,
    });

    if (!share.links.opensDirectChat || !share.links.phoneDigits) {
      setError(
        "Telefone inválido para WhatsApp/SMS. Use DDD + número com 10 ou 11 dígitos (ex.: 11999998888)."
      );
      return;
    }

    setError(null);
    setInfo(null);
    copyTextToClipboardSync(share.message);

    if (channel === "whatsapp") {
      const href = washReadyWhatsAppHref(share.links);
      if (!href) {
        setError("Não foi possível montar o link do WhatsApp. Verifique o telefone.");
        return;
      }
      void persistReadyStatus(row);
      // Mesma aba — não usa popup (bloqueado no Chrome/Edge).
      launchShareHref(href);
      return;
    }

    if (!canUseDeviceSms()) {
      setError(
        "SMS só funciona no celular. No computador use Pronto (WhatsApp). Mensagem já copiada (Ctrl+V)."
      );
      void persistReadyStatus(row);
      return;
    }

    const sms = buildSmsShareHref(row.phone, share.message);
    if (!sms) {
      setError("Não foi possível abrir o SMS. Verifique o telefone.");
      return;
    }
    void persistReadyStatus(row);
    launchShareHref(sms);
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
    const completed = data as CarWashServiceRow;
    if (!completed.is_loyalty_reward && Number(completed.service_amount) > 0) {
      const posted = await postCarWashRevenue({
        supabase,
        companyId,
        row: completed,
      });
      if (posted.error) {
        setSaving(false);
        setError(posted.error);
        await load();
        return;
      }
    }
    setSaving(false);

    if (loyaltySettings?.wash_loyalty_enabled && !completed.is_loyalty_reward) {
      const history = await listWashHistoryForPlate(supabase, companyId, completed.plate);
      const progress = computeWashLoyaltyProgress(history.rows, loyaltySettings);
      if (progress.availableFree > 0 && progress.paidCompleted % progress.everyN === 0) {
        setInfo(
          `Placa ${completed.plate}: a cada ${progress.everyN} lavagens ganhou ${progress.rewardQty} grátis. Crédito disponível!`
        );
      }
    }
    await load();
  };

  const plateGroups = useMemo(
    () =>
      groupByKeySorted(rows, (row) => (row.plate || "").trim().toUpperCase() || row.id, (a, b) =>
        String(b.service_date || "").localeCompare(String(a.service_date || ""))
      ),
    [rows]
  );

  function renderReadyActions(row: CarWashServiceRow) {
    if (!canEdit) return null;
    if (row.status !== "Aberto" && row.status !== "Pronto") return null;

    const share = buildWashReadyWhatsApp({
      companyName,
      plate: row.plate,
      phone: row.phone,
      clientName: row.client_name,
      serviceName: row.service_name,
    });
    const waHref = washReadyWhatsAppHref(share.links);
    const smsHref = canUseDeviceSms() ? buildSmsShareHref(row.phone, share.message) : null;
    const linkClass = `${glassAction("emerald", true)} inline-flex items-center justify-center`;

    return (
      <>
        {waHref ? (
          <a
            href={waHref}
            className={linkClass}
            title="Avisar no WhatsApp que o veículo está pronto"
            onClick={() => {
              copyTextToClipboardSync(share.message);
              void persistReadyStatus(row);
            }}
          >
            Pronto (WhatsApp)
          </a>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => markReady(row, "whatsapp")}
            title="Informe telefone DDD + número na ordem"
          >
            Pronto (WhatsApp)
          </Button>
        )}
        {smsHref ? (
          <a
            href={smsHref}
            className={linkClass}
            title="Abrir SMS do aparelho"
            onClick={() => {
              copyTextToClipboardSync(share.message);
              void persistReadyStatus(row);
            }}
          >
            Pronto (SMS)
          </a>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => markReady(row, "sms")}
            title="SMS só no celular; no PC use WhatsApp"
          >
            Pronto (SMS)
          </Button>
        )}
      </>
    );
  }

  if (!companyId) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Lava-rápido</h1>
        <p className="mt-1 text-sm text-slate-500">
          Aviso de veículo pronto (WhatsApp/SMS), ticket digital e fidelidade por placa. Parâmetros em{" "}
          <Link href="/configuracoes/parametros-patio" className="text-brand-700 underline">
            Parâmetros do Pátio
          </Link>
          .
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {info ? <Alert variant="info">{info}</Alert> : null}
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
                value={
                  plateLoyalty?.availableFree
                    ? `${formatCurrency(quotedPrice ?? 0)} · ou grátis (fidelidade)`
                    : quotedPrice != null
                      ? formatCurrency(quotedPrice)
                      : "— sem preço —"
                }
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
              <span className="text-sm font-medium text-slate-700">Telefone (WhatsApp/SMS)</span>
              <input
                className={glassField(true)}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="DDD + número"
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
          {plateLoyalty?.enabled && form.plate.trim() ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Cartão fidelidade · {normalizePlate(form.plate)}: {washLoyaltyLabel(plateLoyalty)}
            </p>
          ) : null}
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
                <p className="mt-1 text-xs text-slate-500">
                  {row.client_name?.trim() || "Cliente —"} ·{" "}
                  {row.phone?.trim() || (
                    <span className="font-medium text-red-600">sem telefone</span>
                  )}
                </p>
                <p className="mt-2 text-sm leading-snug break-words text-slate-800">
                  {row.service_name}
                  {row.is_loyalty_reward ? " · Fidelidade" : ""}
                </p>
                {row.service_amount != null ? (
                  <p className="mt-2 text-base font-bold tabular-nums text-slate-900">
                    {row.is_loyalty_reward ? "Grátis" : formatCurrency(Number(row.service_amount))}
                  </p>
                ) : null}
              </div>
              <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <Link
                href={`/operacional/lava-rapido/${row.id}/ticket`}
                className={`text-center ${glassAction("sky", true)}`}
              >
                Ticket
              </Link>
              {renderReadyActions(row)}
              {(row.status === "Aberto" || row.status === "Pronto") && canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void completeService(row)}
                >
                  Entregar / concluir
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
        <DataTableScroll stickyFirst stickyLast>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Código</th>
                <th className="px-3 py-2.5">Data</th>
                <th className="px-3 py-2.5">Placa</th>
                <th className="px-3 py-2.5">Serviço</th>
                <th className="px-3 py-2.5">Valor</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Ticket</th>
                <th className="px-3 py-2.5">Ações</th>
              </tr>
            </thead>
            <GroupedTableBodies groups={plateGroups} colSpan={8}>
              {(group) =>
                group.rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={group.multi ? "align-top" : "border-t border-slate-100"}
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-medium">{row.code}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {formatDateBR(row.service_date)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900">
                      {index === 0 || !group.multi ? (
                        row.plate
                      ) : (
                        <span className="text-slate-300" aria-hidden>
                          ↳
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.service_name}
                      {row.is_loyalty_reward ? (
                        <span className="ml-1 text-xs text-amber-700">fidelidade</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {row.is_loyalty_reward
                        ? "Grátis"
                        : row.service_amount != null
                          ? formatCurrency(Number(row.service_amount))
                          : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/operacional/lava-rapido/${row.id}/ticket`}
                        className={glassAction("sky", true)}
                      >
                        Ticket
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {renderReadyActions(row)}
                        {(row.status === "Aberto" || row.status === "Pronto") && canEdit ? (
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
                    </td>
                  </tr>
                ))
              }
            </GroupedTableBodies>
          </table>
        </DataTableScroll>
      </div>
    </div>
  );
}
