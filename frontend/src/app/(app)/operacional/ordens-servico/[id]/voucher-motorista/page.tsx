"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ServiceOrderDriverVoucherView,
  type DriverVoucherContext,
} from "@/components/operacional/ServiceOrderDriverVoucherView";
import { Loading, Alert } from "@/components/ui/Badge";
import {
  canViewDriverVoucher,
  isDriverAssignmentPendingAcceptance,
  resolveDesignatedDriverId,
} from "@/lib/service-order-display-status";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";
import type { Driver, ServiceOrder, Vehicle } from "@/types/database";

function buildVehicleDescription(order: ServiceOrder, vehicle: Vehicle | null): string {
  const parts = [
    order.vehicle_type,
    order.model ?? vehicle?.model,
    order.year ?? vehicle?.year,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export default function ServiceOrderDriverVoucherPage() {
  const params = useParams();
  const orderId = String(params.id ?? "");
  const { company } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [context, setContext] = useState<DriverVoucherContext | null>(null);
  const [pendingAcceptance, setPendingAcceptance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setError("Ordem de serviço não informada.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("service_orders")
        .select("*")
        .eq("id", orderId)
        .single();

      if (cancelled) return;

      if (fetchError || !data) {
        setError(fetchError?.message ?? "Ordem de serviço não encontrada.");
        setLoading(false);
        return;
      }

      const row = data as ServiceOrder;

      if (!canViewDriverVoucher(row)) {
        setError(
          "O voucher fica disponível depois que o cliente aceitar a proposta e você designar um motorista na OS."
        );
        setLoading(false);
        return;
      }

      const driverId = resolveDesignatedDriverId(row);

      setOrder(row);
      setPendingAcceptance(isDriverAssignmentPendingAcceptance(row));

      const [driverRes, vehicleRes] = await Promise.all([
        driverId
          ? supabase.from("drivers").select("*").eq("id", driverId).maybeSingle()
          : Promise.resolve({ data: null }),
        row.vehicle_id
          ? supabase.from("vehicles").select("*").eq("id", row.vehicle_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (cancelled) return;

      const driver = driverRes.data as Driver | null;
      const vehicle = vehicleRes.data as Vehicle | null;

      setContext({
        companyName: company?.trade_name || company?.name || "GRX Management",
        companyDocument: company?.document ?? null,
        driverName: driver?.name ?? "Motorista designado",
        driverDocument: driver?.document ?? driver?.cnh_number ?? null,
        driverPhone: driver?.phone ?? null,
        vehicleDescription: buildVehicleDescription(row, vehicle),
      });

      if (!row.driver_voucher_generated_at) {
        await supabase
          .from("service_orders")
          .update({ driver_voucher_generated_at: new Date().toISOString() })
          .eq("id", row.id);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, supabase, company?.document, company?.name, company?.trade_name]);

  if (loading) {
    return (
      <div className="space-y-3 py-12 text-center">
        <Loading />
        <p className="text-sm text-slate-500">Carregando voucher do motorista...</p>
      </div>
    );
  }

  if (error || !order || !context) {
    return <Alert variant="error">{error ?? "Não foi possível carregar o voucher."}</Alert>;
  }

  return (
    <div className="space-y-4">
      <Link
        href="/operacional/ordens-servico"
        className="driver-voucher-toolbar text-sm text-brand-700 underline print:hidden"
      >
        ← Voltar às ordens de serviço
      </Link>
      <ServiceOrderDriverVoucherView
        order={order}
        context={context}
        pendingDriverAcceptance={pendingAcceptance}
      />
    </div>
  );
}
