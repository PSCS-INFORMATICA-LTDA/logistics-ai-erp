"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MailIcon, WhatsAppIcon } from "@/components/icons/ShareIcons";
import { Button } from "@/components/ui/Button";
import { Loading } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useCompany } from "@/lib/company-context";
import {
  enrichDriversWithServiceOrders,
  isDriverAvailableForContact,
  type DriverListRow,
} from "@/lib/driver-filters";
import { fetchActiveServiceOrdersByDriver } from "@/lib/driver-service-orders";
import { assignServiceOrderDriver } from "@/lib/service-order-driver-api";
import {
  buildPublicDriverAssignmentUrl,
  formatMoneyInputValue,
  parseBrazilianMoneyInput,
  prepareDriverAssignmentSharePayload,
  sendDriverAssignment,
  shareDriverAssignmentViaWhatsApp,
  type DriverAssignmentPayDetails,
  type DriverAssignmentSharePayload,
} from "@/lib/service-order-driver-assignment";
import {
  copyTextToClipboardSync,
  openMailtoLink,
} from "@/lib/service-order-proposal";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCurrency } from "@/lib/utils";
import type { Driver, ServiceOrder } from "@/types/database";
type OrderSummary = Pick<
  ServiceOrder,
  | "id"
  | "code"
  | "plate"
  | "client_name"
  | "service_type"
  | "service_date"
  | "freight_origin_address"
  | "freight_destination_address"
  | "freight_distance_km"
  | "freight_agreed_amount"
  | "freight_toll_amount"
  | "service_amount"
  | "driver_assignment_response"
  | "proposed_driver_id"
  | "driver_assignment_rejected_at"
  | "driver_assignment_rejected_driver_ids"
  | "driver_assignment_pay_amount"
  | "driver_assignment_assistant_pay_amount"
> & {
  driver_name?: string | null;
  proposed_driver_code?: string | null;
};

const ORDER_ASSIGNMENT_FIELDS =
  "id, code, plate, client_name, service_type, service_date, freight_origin_address, freight_destination_address, freight_distance_km, freight_agreed_amount, freight_toll_amount, service_amount, driver_assignment_response, proposed_driver_id, driver_assignment_rejected_at, driver_assignment_rejected_driver_ids, driver_assignment_pay_amount, driver_assignment_assistant_pay_amount";

const ORDER_ASSIGNMENT_FIELDS_LEGACY =
  "id, code, plate, client_name, service_type, service_date, freight_origin_address, freight_destination_address, freight_distance_km, freight_agreed_amount, freight_toll_amount, service_amount, driver_assignment_response, proposed_driver_id, driver_assignment_rejected_at";

type Props = {
  open: boolean;
  order: OrderSummary;
  onClose: () => void;
  onAssigned: (driverId: string, driverName: string) => void;
  onAssignmentSent?: (driverId: string, driverName: string) => void;
};

function driverAvailabilityLabel(driver: DriverListRow): string {
  if (isDriverAvailableForContact(driver)) return "Disponível";
  if (driver.active_service_order_code) {
    return `Em OS ${driver.active_service_order_code}`;
  }
  if (driver.status !== "Ativo") return "Inativo";
  if (!driver.active_for_operations) return "Fora de operação";
  return "Indisponível";
}

function DriverRefusedMark({ orderCode }: { orderCode: string }) {
  return (
    <span
      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 border-red-500 bg-red-500 text-white shadow-sm"
      title={`Recusou a ${orderCode}`}
      aria-label={`Recusou a ${orderCode}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-2.5 w-2.5"
        aria-hidden
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

export function AssignDriverModal({ open, order, onClose, onAssigned, onAssignmentSent }: Props) {
  const { companyId, company } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [drivers, setDrivers] = useState<DriverListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [orderDetails, setOrderDetails] = useState<OrderSummary>(order);

  const [sharePayload, setSharePayload] = useState<DriverAssignmentSharePayload | null>(null);
  const [shareDriverName, setShareDriverName] = useState("");
  const [driverPayInput, setDriverPayInput] = useState("");
  const [assistantPayInput, setAssistantPayInput] = useState("");

  const secondaryActionClass =
    "inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const companyName = company?.trade_name || company?.name || "GRX Transportes e Logística";
  const selectedDriver = drivers.find((d) => d.id === selectedId);
  const rejectedDriverIds = orderDetails.driver_assignment_rejected_driver_ids ?? [];

  const isDriverRefusedForThisOrder = (driver: DriverListRow): boolean => {
    if (rejectedDriverIds.includes(driver.id)) return true;

    if (orderDetails.driver_assignment_response !== "rejected") return false;

    if (orderDetails.proposed_driver_id && driver.id === orderDetails.proposed_driver_id) {
      return true;
    }
    if (orderDetails.proposed_driver_code && driver.code === orderDetails.proposed_driver_code) {
      return true;
    }
    if (orderDetails.driver_name && driver.name === orderDetails.driver_name) return true;
    return false;
  };

  const resetShareStep = () => {
    setSharePayload(null);
    setShareDriverName("");
  };

  const resolvePayDetails = (): DriverAssignmentPayDetails | null => {
    const driverPay = parseBrazilianMoneyInput(driverPayInput);
    if (driverPay == null || driverPay <= 0) {
      window.alert("Informe o valor a pagar ao motorista (ex.: 120 ou 120,50).");
      return null;
    }

    const assistantRaw = assistantPayInput.trim();
    let assistantPay: number | null = null;
    if (assistantRaw) {
      assistantPay = parseBrazilianMoneyInput(assistantRaw);
      if (assistantPay == null || assistantPay < 0) {
        window.alert("Valor do ajudante inválido.");
        return null;
      }
    }

    return {
      driverPayAmount: driverPay,
      assistantPayAmount: assistantPay && assistantPay > 0 ? assistantPay : null,
    };
  };

  const loadDrivers = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);

    const [driversRes, activeOrders] = await Promise.all([
      supabase
        .from("drivers")
        .select("id, code, name, status, active_for_operations, phone, email, address")
        .eq("company_id", companyId)
        .eq("status", "Ativo")
        .is("deleted_at", null)
        .order("name"),
      fetchActiveServiceOrdersByDriver(companyId),
    ]);

    if (driversRes.error) {
      setError(driversRes.error.message);
      setDrivers([]);
      setLoading(false);
      return;
    }

    const rows = enrichDriversWithServiceOrders(
      (driversRes.data as Driver[]) ?? [],
      activeOrders
    );

    rows.sort((a, b) => {
      const aAvail = isDriverAvailableForContact(a);
      const bAvail = isDriverAvailableForContact(b);
      if (aAvail !== bAvail) return aAvail ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });

    setDrivers(rows);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    setOrderDetails(order);
  }, [order]);

  const refetchOrderAssignment = useCallback(async () => {
    let data: Record<string, unknown> | null = null;

    const fullRes = await supabase
      .from("service_orders")
      .select(ORDER_ASSIGNMENT_FIELDS)
      .eq("id", order.id)
      .single();

    if (fullRes.error) {
      const legacyRes = await supabase
        .from("service_orders")
        .select(ORDER_ASSIGNMENT_FIELDS_LEGACY)
        .eq("id", order.id)
        .single();
      if (legacyRes.error || !legacyRes.data) return;
      data = legacyRes.data as Record<string, unknown>;
    } else {
      data = fullRes.data as Record<string, unknown>;
    }

    const rejectedIds = [
      ...new Set([
        ...((data.driver_assignment_rejected_driver_ids as string[] | null) ?? []),
        ...(order.driver_assignment_rejected_driver_ids ?? []),
      ]),
    ];
    const proposedDriverId = (data.proposed_driver_id as string | null) ?? null;
    const assignmentResponse =
      (data.driver_assignment_response as OrderSummary["driver_assignment_response"]) ?? "pending";

    const driverLookupIds = [
      ...new Set([proposedDriverId, ...rejectedIds].filter(Boolean)),
    ] as string[];

    let driverName = order.driver_name ?? null;
    let proposedDriverCode = order.proposed_driver_code ?? null;

    if (driverLookupIds.length) {
      const { data: driversData } = await supabase
        .from("drivers")
        .select("id, name, code")
        .in("id", driverLookupIds);
      const byId = new Map((driversData ?? []).map((d) => [d.id, d]));

      if (proposedDriverId) {
        const proposed = byId.get(proposedDriverId);
        driverName = proposed?.name ?? driverName;
        proposedDriverCode = proposed?.code ?? proposedDriverCode;
      } else if (assignmentResponse === "rejected" && rejectedIds.length) {
        const lastRejectedId = rejectedIds[rejectedIds.length - 1]!;
        const rejected = byId.get(lastRejectedId);
        driverName = rejected?.name ?? driverName;
        proposedDriverCode = rejected?.code ?? proposedDriverCode;
      }
    }

    setOrderDetails({
      ...order,
      ...(data as OrderSummary),
      driver_assignment_response: assignmentResponse,
      proposed_driver_id: proposedDriverId,
      driver_assignment_rejected_driver_ids: rejectedIds,
      driver_name: driverName,
      proposed_driver_code: proposedDriverCode,
    });
  }, [order, supabase]);

  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    resetShareStep();
    setDriverPayInput(formatMoneyInputValue(order.driver_assignment_pay_amount));
    setAssistantPayInput(formatMoneyInputValue(order.driver_assignment_assistant_pay_amount));
    void refetchOrderAssignment();
    void loadDrivers();
  }, [open, loadDrivers, order.driver_assignment_assistant_pay_amount, order.driver_assignment_pay_amount, refetchOrderAssignment]);

  useEffect(() => {
    if (!open || sharePayload) return;
    if (orderDetails.driver_assignment_pay_amount != null) {
      setDriverPayInput(formatMoneyInputValue(orderDetails.driver_assignment_pay_amount));
    }
    if (orderDetails.driver_assignment_assistant_pay_amount != null) {
      setAssistantPayInput(formatMoneyInputValue(orderDetails.driver_assignment_assistant_pay_amount));
    }
  }, [
    open,
    sharePayload,
    orderDetails.driver_assignment_assistant_pay_amount,
    orderDetails.driver_assignment_pay_amount,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const registerAssignmentShareForDriver = async (
    driver: DriverListRow,
    payDetails?: DriverAssignmentPayDetails | null,
    options?: { notifySent?: boolean }
  ): Promise<DriverAssignmentSharePayload | null> => {
    if (!isDriverAvailableForContact(driver)) {
      window.alert("Motorista indisponível para esta designação.");
      return null;
    }

    if (!driver.phone?.trim() && !driver.email?.trim()) {
      window.alert(
        "Cadastre telefone ou e-mail do motorista em Cadastros → Motoristas antes de enviar o link."
      );
      return null;
    }

    const resolvedPay = payDetails ?? resolvePayDetails();
    if (!resolvedPay) return null;

    setSelectedId(driver.id);
    setSaving(true);

    const { token, error: sendError } = await sendDriverAssignment(
      supabase,
      order.id,
      driver.id,
      resolvedPay
    );
    if (sendError || !token) {
      setSaving(false);
      window.alert(sendError ?? "Não foi possível registrar a designação.");
      return null;
    }

    const payload = await buildSharePayloadForDriver(driver, token, resolvedPay);
    setSaving(false);
    if (!payload) return null;

    setSharePayload(payload);
    setShareDriverName(driver.name);
    if (options?.notifySent !== false) {
      onAssignmentSent?.(driver.id, driver.name);
    }
    return payload;
  };

  const buildSharePayloadForDriver = async (
    driver: DriverListRow,
    token: string,
    payDetails: DriverAssignmentPayDetails
  ): Promise<DriverAssignmentSharePayload | null> => {
    const assignmentUrl = buildPublicDriverAssignmentUrl(token);
    return prepareDriverAssignmentSharePayload(
      driver.email,
      orderDetails,
      companyName,
      driver.name,
      assignmentUrl,
      payDetails,
      driver.phone
    );
  };

  const confirmAndRegisterShare = async (
    driver: DriverListRow
  ): Promise<DriverAssignmentSharePayload | null> => {
    if (sharePayload && selectedId === driver.id) {
      return sharePayload;
    }

    const payDetails = resolvePayDetails();
    if (!payDetails) return null;

    const refused = isDriverRefusedForThisOrder(driver);
    const confirmed = window.confirm(
      refused
        ? `Reenviar designação da ${orderDetails.code} para ${driver.name}?\n\nValor motorista: ${formatCurrency(payDetails.driverPayAmount)}${payDetails.assistantPayAmount ? `\nValor ajudante: ${formatCurrency(payDetails.assistantPayAmount)}` : ""}\n\nO link ficará ativo para o motorista aceitar ou recusar. Se fechar o WhatsApp sem enviar, use «Cancelar designação» na lista da OS.`
        : `Registrar envio da designação da ${orderDetails.code} para ${driver.name}?\n\nValor motorista: ${formatCurrency(payDetails.driverPayAmount)}${payDetails.assistantPayAmount ? `\nValor ajudante: ${formatCurrency(payDetails.assistantPayAmount)}` : ""}\n\nO link ficará ativo para o motorista aceitar ou recusar. Se fechar o WhatsApp sem enviar, use «Cancelar designação» na lista da OS.`
    );
    if (!confirmed) return null;

    return registerAssignmentShareForDriver(driver, payDetails, { notifySent: false });
  };

  const resolveSharePayloadForDriver = async (
    driver: DriverListRow
  ): Promise<DriverAssignmentSharePayload | null> => {
    if (sharePayload && selectedId === driver.id) {
      return sharePayload;
    }
    return confirmAndRegisterShare(driver);
  };

  const handleDirectAssign = async () => {
    if (!selectedDriver || !isDriverAvailableForContact(selectedDriver)) {
      window.alert("Selecione um motorista disponível.");
      return;
    }

    setSaving(true);
    const { error: saveError } = await assignServiceOrderDriver(supabase, order.id, selectedId);
    setSaving(false);

    if (saveError) {
      window.alert(saveError);
      return;
    }

    onAssigned(selectedId, selectedDriver.name);
    onClose();
  };

  const registerAssignmentShare = async (): Promise<boolean> => {
    if (!selectedDriver) {
      window.alert("Selecione um motorista.");
      return false;
    }
    const payDetails = resolvePayDetails();
    if (!payDetails) return false;
    const payload = await registerAssignmentShareForDriver(selectedDriver, payDetails);
    return Boolean(payload);
  };

  const handlePrepareShare = () => {
    void registerAssignmentShare();
  };

  const launchDriverWhatsAppShare = async (
    payload: DriverAssignmentSharePayload,
    phone: string | null | undefined,
    preOpened?: Window | null
  ) => {
    await shareDriverAssignmentViaWhatsApp(payload.whatsappMessage, phone, {
      preOpenedWindow: preOpened ?? null,
      urlText: payload.whatsappLinks.message,
    });
  };

  const handleDriverWhatsAppMouseDown = (
    event: React.MouseEvent,
    payload: DriverAssignmentSharePayload | null
  ) => {
    event.stopPropagation();
    if (payload) {
      copyTextToClipboardSync(payload.whatsappMessage);
    }
  };

  const handleDriverWhatsAppClick = (event: React.MouseEvent, driver: DriverListRow) => {
    event.preventDefault();
    event.stopPropagation();
    if (!driver.phone?.trim() || saving) return;

    void (async () => {
      if (sharePayload && selectedId === driver.id) {
        const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
        await launchDriverWhatsAppShare(sharePayload, driver.phone, popup);
        return;
      }

      const payDetails = resolvePayDetails();
      if (!payDetails) return;

      const refused = isDriverRefusedForThisOrder(driver);
      const confirmed = window.confirm(
        refused
          ? `Reenviar designação da ${orderDetails.code} para ${driver.name}?\n\nValor motorista: ${formatCurrency(payDetails.driverPayAmount)}${payDetails.assistantPayAmount ? `\nValor ajudante: ${formatCurrency(payDetails.assistantPayAmount)}` : ""}\n\nO link ficará ativo para o motorista aceitar ou recusar. Se fechar o WhatsApp sem enviar, use «Cancelar designação» na lista da OS.`
          : `Registrar envio da designação da ${orderDetails.code} para ${driver.name}?\n\nValor motorista: ${formatCurrency(payDetails.driverPayAmount)}${payDetails.assistantPayAmount ? `\nValor ajudante: ${formatCurrency(payDetails.assistantPayAmount)}` : ""}\n\nO link ficará ativo para o motorista aceitar ou recusar. Se fechar o WhatsApp sem enviar, use «Cancelar designação» na lista da OS.`
      );
      if (!confirmed) return;

      const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
      const payload = await registerAssignmentShareForDriver(driver, payDetails, {
        notifySent: false,
      });
      if (!payload) {
        popup?.close();
        return;
      }

      await launchDriverWhatsAppShare(payload, driver.phone, popup);
      onAssignmentSent?.(driver.id, driver.name);
    })();
  };

  const handleDriverEmailClick = (event: React.MouseEvent, driver: DriverListRow) => {
    event.preventDefault();
    event.stopPropagation();
    if (!driver.email?.trim() || saving) return;

    void (async () => {
      const payload = await resolveSharePayloadForDriver(driver);
      if (!payload?.emailBundle) {
        window.alert("E-mail do motorista não cadastrado.");
        return;
      }
      openMailtoLink(payload.emailBundle.mailtoHref);
      onAssignmentSent?.(driver.id, driver.name);
    })();
  };

  const handleWhatsAppShareMouseDown = () => {
    if (!sharePayload) return;
    copyTextToClipboardSync(sharePayload.whatsappMessage);
  };

  const handleWhatsAppShareClick = () => {
    if (!sharePayload || !selectedDriver?.phone?.trim()) return;
    void (async () => {
      const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
      await launchDriverWhatsAppShare(sharePayload, selectedDriver.phone, popup);
    })();
  };

  const handleEmailShareClick = () => {
    if (!sharePayload?.emailBundle) {
      window.alert("E-mail do motorista não cadastrado ou conteúdo ainda não preparado.");
      return;
    }
    openMailtoLink(sharePayload.emailBundle.mailtoHref);
  };
  if (!open) return null;

  const sortedDrivers = [...drivers].sort((a, b) => {
    const aRefused = isDriverRefusedForThisOrder(a);
    const bRefused = isDriverRefusedForThisOrder(b);
    if (aRefused !== bRefused) return aRefused ? -1 : 1;
    const aAvail = isDriverAvailableForContact(a);
    const bAvail = isDriverAvailableForContact(b);
    if (aAvail !== bAvail) return aAvail ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-driver-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 id="assign-driver-title" className="text-lg font-semibold text-slate-900">
            Designar motorista
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            OS <strong>{orderDetails.code}</strong>
            {orderDetails.plate ? ` · ${orderDetails.plate}` : ""}
          </p>
          {orderDetails.client_name ? (
            <p className="text-sm text-slate-600">{orderDetails.client_name}</p>
          ) : null}
          {(orderDetails.freight_origin_address || orderDetails.freight_destination_address) && (
            <div className="mt-1 space-y-0.5 text-sm text-slate-500">
              <p>
                <span className="font-medium text-slate-600">A:</span>{" "}
                {orderDetails.freight_origin_address ?? "—"}
              </p>
              <p>
                <span className="font-medium text-slate-600">B:</span>{" "}
                {orderDetails.freight_destination_address ?? "—"}
              </p>
              {orderDetails.freight_distance_km ? (
                <p className="text-xs">Distância: {orderDetails.freight_distance_km} km</p>
              ) : null}
              {orderDetails.freight_toll_amount ? (
                <p className="text-xs">Pedágio: {formatCurrency(orderDetails.freight_toll_amount)}</p>
              ) : null}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Informe os valores a pagar ao motorista (e ao ajudante, se houver) antes de enviar.
            Ao clicar em WhatsApp, e-mail ou «Gerar link e enviar», confirme o registro do envio —
            só então o link fica ativo para o motorista aceitar ou recusar. Quem já recusou aparece
            em vermelho e pode ser reenviado. Se fechar o WhatsApp sem enviar, use «Cancelar
            designação» na lista.
          </p>
        </div>

        {!sharePayload ? (
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Valor a pagar ao motorista *"
                type="text"
                inputMode="decimal"
                placeholder="Ex.: 120 ou 120,50"
                value={driverPayInput}
                onChange={(event) => setDriverPayInput(event.target.value)}
                disabled={saving}
              />
              <Input
                label="Valor do ajudante (opcional)"
                type="text"
                inputMode="decimal"
                placeholder="Ex.: 50"
                value={assistantPayInput}
                onChange={(event) => setAssistantPayInput(event.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        ) : null}

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          {sharePayload ? (
            <div className="space-y-4">
              <p className="text-sm text-emerald-800">
                Designação registrada para <strong>{shareDriverName}</strong>. Use os ícones abaixo
                ou na lista do motorista para enviar.
              </p>
              <p className="break-all text-xs text-slate-500">{sharePayload.assignmentUrl}</p>
              {selectedDriver?.phone?.trim() ? (
                <button
                  type="button"
                  title="Enviar designação por WhatsApp"
                  aria-label="Enviar designação por WhatsApp"
                  disabled={saving}
                  className={cn(
                    secondaryActionClass,
                    "w-full border-green-300 bg-green-50 text-green-900 hover:bg-green-100"
                  )}
                  onMouseDown={handleWhatsAppShareMouseDown}
                  onClick={handleWhatsAppShareClick}
                >
                  <WhatsAppIcon className="h-5 w-5" />
                </button>
              ) : null}
              {sharePayload.emailBundle ? (
                <button
                  type="button"
                  title="Enviar designação por e-mail"
                  aria-label="Enviar designação por e-mail"
                  disabled={saving}
                  className={cn(
                    secondaryActionClass,
                    "w-full border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100"
                  )}
                  onClick={handleEmailShareClick}
                >
                  <MailIcon className="h-5 w-5" />
                </button>
              ) : null}            </div>
          ) : loading ? (
            <Loading />
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : drivers.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum motorista ativo cadastrado.</p>
          ) : (
            <ul className="space-y-2">
              {rejectedDriverIds.length > 0 ? (
                <li className="rounded-lg border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
                  {rejectedDriverIds.length === 1
                    ? "1 motorista recusou esta OS (destacado em vermelho). Você pode reenviar se conversar com ele novamente."
                    : `${rejectedDriverIds.length} motoristas recusaram esta OS (destacados em vermelho). Você pode reenviar a qualquer um deles se necessário.`}
                </li>
              ) : null}
              {sortedDrivers.map((driver) => {
                const refused = isDriverRefusedForThisOrder(driver);
                const available = isDriverAvailableForContact(driver);
                const label = driverAvailabilityLabel(driver);
                const selected = selectedId === driver.id;

                return (
                  <li key={driver.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors",
                        refused
                          ? selected
                            ? "border-red-500 bg-red-100 ring-1 ring-red-300"
                            : "border-red-300 bg-red-50 hover:border-red-400 hover:bg-red-100/80"
                          : selected
                            ? "border-brand-500 bg-brand-50"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                        !available && !refused && "opacity-70"
                      )}
                    >
                      <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
                        {refused ? <DriverRefusedMark orderCode={orderDetails.code} /> : null}
                        <input
                          type="radio"
                          name="assign-driver"
                          value={driver.id}
                          checked={selected}
                          onChange={() => setSelectedId(driver.id)}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "font-medium",
                              refused ? "text-red-900" : "text-slate-900"
                            )}
                          >
                            {driver.code} — {driver.name}
                          </span>
                          {refused ? (
                            <span className="rounded-full bg-red-200 px-2 py-0.5 text-xs font-semibold text-red-900">
                              Recusou
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            refused
                              ? "text-red-800"
                              : available
                                ? "text-green-700"
                                : "text-slate-500"
                          )}
                        >
                          {refused ? `Recusou a ${orderDetails.code}` : label}
                          {refused && orderDetails.driver_assignment_rejected_at
                            ? ` · ${new Date(orderDetails.driver_assignment_rejected_at).toLocaleString("pt-BR")}`
                            : ""}
                          {driver.phone ? ` · ${driver.phone}` : " · sem telefone"}
                          {driver.email ? ` · ${driver.email}` : ""}
                        </span>
                        {driver.address ? (
                          <span
                            className={cn(
                              "mt-0.5 block text-xs",
                              refused ? "text-red-800/70" : "text-slate-500"
                            )}
                          >
                            {driver.address}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {driver.phone ? (
                          <button
                            type="button"
                            title={
                              refused
                                ? "Reenviar designação por WhatsApp"
                                : "Enviar designação por WhatsApp"
                            }
                            aria-label={`WhatsApp — ${driver.name}`}
                            disabled={saving || (!available && !refused)}
                            className={cn(
                              "rounded-lg border p-2 disabled:opacity-50",
                              refused
                                ? "border-red-300 bg-white text-red-800 hover:bg-red-50"
                                : "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
                            )}
                            onMouseDown={(event) =>
                              handleDriverWhatsAppMouseDown(
                                event,
                                sharePayload && selectedId === driver.id ? sharePayload : null
                              )
                            }
                            onClick={(event) => handleDriverWhatsAppClick(event, driver)}
                          >
                            <WhatsAppIcon className="h-4 w-4" />
                          </button>
                        ) : null}
                        {driver.email ? (
                          <button
                            type="button"
                            title={
                              refused
                                ? "Reenviar designação por e-mail"
                                : "Enviar designação por e-mail"
                            }
                            aria-label={`E-mail — ${driver.name}`}
                            disabled={saving || (!available && !refused)}
                            className={cn(
                              "rounded-lg border p-2 disabled:opacity-50",
                              refused
                                ? "border-red-300 bg-white text-red-800 hover:bg-red-50"
                                : "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100"
                            )}
                            onClick={(event) => handleDriverEmailClick(event, driver)}
                          >
                            <MailIcon className="h-4 w-4" />
                          </button>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              {sharePayload ? "Fechar" : "Cancelar"}
            </Button>
            {!sharePayload ? (
              <Button
                type="button"
                variant="secondary"
                disabled={saving || loading || !selectedId}
                onClick={() => void handleDirectAssign()}
              >
                Confirmar sem link
              </Button>
            ) : null}
          </div>
          {!sharePayload ? (
            <Button
              type="button"
              disabled={
                saving ||
                loading ||
                !selectedId ||
                !driverPayInput.trim() ||
                (!selectedDriver?.phone?.trim() && !selectedDriver?.email?.trim())
              }
              title="Registra o envio da designação e abre opções de compartilhamento"
              onClick={handlePrepareShare}
            >
              {saving ? "Preparando…" : "Gerar link e enviar"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
