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
import { createClient } from "@/lib/supabase/client";
import { cn, formatCurrency } from "@/lib/utils";
import type { Driver, ServiceOrder } from "@/types/database";

type OrderSummary = Pick<
  ServiceOrder,
  | "id"
  | "code"
  | "plate"
  | "client_name"
  | "freight_origin_address"
  | "freight_destination_address"
  | "freight_agreed_amount"
  | "service_amount"
>;

type Props = {
  open: boolean;
  order: OrderSummary;
  onClose: () => void;
  onAssigned: (driverId: string, driverName: string) => void;
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

export function AssignDriverModal({ open, order, onClose, onAssigned }: Props) {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [drivers, setDrivers] = useState<DriverListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");

  const amount = order.freight_agreed_amount ?? order.service_amount;

  const loadDrivers = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);

    const [driversRes, activeOrders] = await Promise.all([
      supabase
        .from("drivers")
        .select("id, code, name, status, active_for_operations, cnh_categories, phone")
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

  const handleConfirm = async () => {
    if (!selectedId) {
      window.alert("Selecione um motorista disponível.");
      return;
    }

    const driver = drivers.find((d) => d.id === selectedId);
    if (!driver || !isDriverAvailableForContact(driver)) {
      window.alert("Motorista indisponível para esta designação.");
      return;
    }

    setSaving(true);
    const { error: saveError } = await assignServiceOrderDriver(supabase, order.id, selectedId);
    setSaving(false);

    if (saveError) {
      window.alert(saveError);
      return;
    }

    onAssigned(selectedId, driver.name);
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
          {order.client_name ? (
            <p className="text-sm text-slate-600">{order.client_name}</p>
          ) : null}
          {(order.freight_origin_address || order.freight_destination_address) && (
            <p className="mt-1 text-sm text-slate-500">
              {order.freight_origin_address ?? "—"} → {order.freight_destination_address ?? "—"}
            </p>
          )}
          {amount != null ? (
            <p className="mt-1 text-sm font-medium text-brand-700">{formatCurrency(amount)}</p>
          ) : null}
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
                        available
                          ? selected
                            ? "border-brand-500 bg-brand-50"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                      )}
                    >
                      <input
                        type="radio"
                        name="assign-driver"
                        value={driver.id}
                        disabled={!available}
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
                          {driver.phone ? ` · ${driver.phone}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={saving || loading || !selectedId}
            onClick={() => void handleConfirm()}
          >
            {saving ? "Salvando…" : "Confirmar designação"}
          </Button>
        </div>
      </div>
    </div>
  );
}
