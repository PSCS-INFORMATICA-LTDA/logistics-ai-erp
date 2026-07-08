"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Loading } from "@/components/ui/Badge";
import { useCompany } from "@/lib/company-context";
import {
  enrichDriversWithServiceOrders,
  isDriverAvailableForContact,
  type DriverListRow,
} from "@/lib/driver-filters";
import { fetchActiveServiceOrdersByDriver } from "@/lib/driver-service-orders";
import { assignServiceOrderDriver } from "@/lib/service-order-driver-api";
import {
  buildDriverAssignmentWhatsAppText,
  buildPublicDriverAssignmentUrl,
  openDriverAssignmentEmailShare,
  sendDriverAssignment,
  shareDriverAssignmentViaWhatsApp,
} from "@/lib/service-order-driver-assignment";
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
  | "service_amount"
>;

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

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
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

  const companyName = company?.trade_name || company?.name || "GRX Transportes e Logística";
  const amount = order.freight_agreed_amount ?? order.service_amount;
  const selectedDriver = drivers.find((d) => d.id === selectedId);

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
    if (!open) return;
    setSelectedId("");
    void loadDrivers();
  }, [open, loadDrivers]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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

  const handleSendWhatsApp = async () => {
    if (!selectedDriver) {
      window.alert("Selecione um motorista.");
      return;
    }

    if (!selectedDriver.phone?.trim()) {
      window.alert(
        "Cadastre o telefone do motorista em Cadastros → Motoristas antes de enviar por WhatsApp."
      );
      return;
    }

    if (!isDriverAvailableForContact(selectedDriver)) {
      window.alert("Motorista indisponível para esta designação.");
      return;
    }

    setSaving(true);
    const { token, error: sendError } = await sendDriverAssignment(supabase, order.id, selectedId);
    setSaving(false);

    if (sendError || !token) {
      window.alert(sendError ?? "Não foi possível registrar a designação.");
      return;
    }

    const assignmentUrl = buildPublicDriverAssignmentUrl(token);
    const message = buildDriverAssignmentWhatsAppText(
      order,
      companyName,
      selectedDriver.name,
      assignmentUrl
    );

    await shareDriverAssignmentViaWhatsApp(message, selectedDriver.phone);
    onAssignmentSent?.(selectedId, selectedDriver.name);
    onClose();
  };

  const handleSendEmail = async () => {
    if (!selectedDriver) {
      window.alert("Selecione um motorista.");
      return;
    }

    if (!selectedDriver.email?.trim()) {
      window.alert(
        "Cadastre o e-mail do motorista em Cadastros → Motoristas antes de enviar por e-mail."
      );
      return;
    }

    if (!isDriverAvailableForContact(selectedDriver)) {
      window.alert("Motorista indisponível para esta designação.");
      return;
    }

    setSaving(true);
    const { token, error: sendError } = await sendDriverAssignment(supabase, order.id, selectedId);
    setSaving(false);

    if (sendError || !token) {
      window.alert(sendError ?? "Não foi possível registrar a designação.");
      return;
    }

    const assignmentUrl = buildPublicDriverAssignmentUrl(token);
    await openDriverAssignmentEmailShare(
      selectedDriver.email.trim(),
      order,
      companyName,
      selectedDriver.name,
      assignmentUrl
    );
    onAssignmentSent?.(selectedId, selectedDriver.name);
    onClose();
  };

  if (!open) return null;

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
            OS <strong>{order.code}</strong>
            {order.plate ? ` · ${order.plate}` : ""}
          </p>
          {order.client_name ? <p className="text-sm text-slate-600">{order.client_name}</p> : null}
          {(order.freight_origin_address || order.freight_destination_address) && (
            <div className="mt-1 space-y-0.5 text-sm text-slate-500">
              <p>
                <span className="font-medium text-slate-600">A:</span>{" "}
                {order.freight_origin_address ?? "—"}
              </p>
              <p>
                <span className="font-medium text-slate-600">B:</span>{" "}
                {order.freight_destination_address ?? "—"}
              </p>
              {order.freight_distance_km ? (
                <p className="text-xs">Distância: {order.freight_distance_km} km</p>
              ) : null}
            </div>
          )}
          {amount != null ? (
            <p className="mt-1 text-sm font-medium text-brand-700">{formatCurrency(amount)}</p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            Envie por WhatsApp ou e-mail para o motorista aceitar pelo link público (como a proposta
            ao cliente). No e-mail, use Ctrl+V no corpo para colar QR Code e logo 3D GRX.
          </p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <Loading />
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : drivers.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum motorista ativo cadastrado.</p>
          ) : (
            <ul className="space-y-2">
              {drivers.map((driver) => {
                const available = isDriverAvailableForContact(driver);
                const label = driverAvailabilityLabel(driver);
                const selected = selectedId === driver.id;

                return (
                  <li key={driver.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors",
                        selected
                          ? "border-brand-500 bg-brand-50"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                        !available && "opacity-70"
                      )}
                    >
                      <input
                        type="radio"
                        name="assign-driver"
                        value={driver.id}
                        checked={selected}
                        onChange={() => setSelectedId(driver.id)}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-900">
                          {driver.code} — {driver.name}
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            available ? "text-green-700" : "text-slate-500"
                          )}
                        >
                          {label}
                          {driver.phone ? ` · ${driver.phone}` : " · sem telefone"}
                          {driver.email ? ` · ${driver.email}` : ""}
                        </span>
                        {driver.address ? (
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {driver.address}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {driver.phone ? (
                          <a
                            href={`https://wa.me/${driver.phone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir WhatsApp do motorista"
                            className="rounded-lg border border-green-300 bg-green-50 p-2 text-green-800 hover:bg-green-100"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <PhoneIcon />
                          </a>
                        ) : null}
                        {driver.email ? (
                          <a
                            href={`mailto:${encodeURIComponent(driver.email.trim())}`}
                            title="Abrir e-mail do motorista"
                            className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-sky-800 hover:bg-sky-100"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <MailIcon />
                          </a>
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
              Cancelar
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || loading || !selectedId}
              onClick={() => void handleDirectAssign()}
            >
              Confirmar sem link
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={saving || loading || !selectedId || !selectedDriver?.email?.trim()}
              title={
                selectedDriver?.email?.trim()
                  ? "Enviar designação por e-mail"
                  : "Cadastre e-mail do motorista"
              }
              onClick={() => void handleSendEmail()}
            >
              {saving ? "Enviando…" : "Enviar por e-mail"}
            </Button>
            <Button
              type="button"
              disabled={saving || loading || !selectedId || !selectedDriver?.phone?.trim()}
              title={
                selectedDriver?.phone?.trim()
                  ? "Enviar designação por WhatsApp"
                  : "Cadastre telefone do motorista"
              }
              onClick={() => void handleSendWhatsApp()}
            >
              Enviar WhatsApp
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
