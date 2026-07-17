"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DriverPhotoUpload } from "@/components/drivers/DriverPhotoUpload";
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
import {
  companyDisplayName,
  getCompanyLogoUrl,
} from "@/lib/company-logo";
import { getDriverPhotoUrl } from "@/lib/driver-photo";
import { getVehiclePhotoUrl } from "@/lib/vehicle-photo";
import { serviceOrderShowsDriverPhoto } from "@/lib/service-order-field-visibility";
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
  const { company, companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [photoStoragePath, setPhotoStoragePath] = useState<string | null>(null);
  const [context, setContext] = useState<DriverVoucherContext | null>(null);
  const [pendingAcceptance, setPendingAcceptance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const rebuildContext = useCallback(
    async (
      row: ServiceOrder,
      nextDriver: Driver | null,
      vehicle: Vehicle | null,
      driverPhotoPath: string | null
    ) => {
      const [driverPhotoUrl, vehiclePhotoUrl, companyLogoUrl] = await Promise.all([
        getDriverPhotoUrl(driverPhotoPath),
        getVehiclePhotoUrl(vehicle?.photo_storage_path),
        getCompanyLogoUrl(company?.logo_storage_path),
      ]);
      setContext({
        companyName: companyDisplayName(company),
        companyDocument: company?.document ?? null,
        companyLogoUrl,
        driverName: nextDriver?.name ?? "Motorista designado",
        driverDocument: nextDriver?.document ?? nextDriver?.cnh_number ?? null,
        driverPhone: nextDriver?.phone ?? null,
        driverPhotoUrl,
        vehiclePhotoUrl,
        vehicleDescription: buildVehicleDescription(row, vehicle),
      });
    },
    [
      company,
      company?.document,
      company?.logo_storage_path,
      company?.name,
      company?.trade_name,
    ]
  );

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

      if (!canViewDriverVoucher(row) && row.status !== "Concluido") {
        setError(
          "O voucher fica disponível depois que o cliente aceitar a proposta e você designar um motorista na OS."
        );
        setLoading(false);
        return;
      }

      const driverId =
        resolveDesignatedDriverId(row) ??
        (row.status === "Concluido"
          ? (
              await supabase
                .from("drivers")
                .select("id")
                .eq("company_id", row.company_id)
                .or("code.eq.MOT001,name.ilike.%Agregado%")
                .limit(1)
                .maybeSingle()
            ).data?.id ?? null
          : null);

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

      const nextDriver = driverRes.data as Driver | null;
      const vehicle = vehicleRes.data as Vehicle | null;
      const photoPath = nextDriver?.photo_storage_path ?? null;

      setDriver(nextDriver);
      setPhotoStoragePath(photoPath);
      await rebuildContext(row, nextDriver, vehicle, photoPath);

      if (!row.driver_voucher_generated_at) {
        await supabase
          .from("service_orders")
          .update({ driver_voucher_generated_at: new Date().toISOString() })
          .eq("id", row.id);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, supabase, rebuildContext]);

  const handlePhotoPathChange = async (path: string | null) => {
    setPhotoStoragePath(path);
    if (!order) return;
    const vehicle = order.vehicle_id
      ? ((
          await supabase.from("vehicles").select("*").eq("id", order.vehicle_id).maybeSingle()
        ).data as Vehicle | null)
      : null;
    const nextDriver = driver
      ? { ...driver, photo_storage_path: path }
      : null;
    if (nextDriver) setDriver(nextDriver);
    await rebuildContext(order, nextDriver, vehicle, path);
  };

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

  const showPhotoUpload = serviceOrderShowsDriverPhoto(order.service_type);

  return (
    <div className="space-y-4">
      <Link
        href="/operacional/ordens-servico"
        className="driver-voucher-toolbar text-sm text-brand-700 underline print:hidden"
      >
        ← Voltar às ordens de serviço
      </Link>

      {showPhotoUpload ? (
        <div className="driver-voucher-toolbar print:hidden">
          {driver?.id ? (
            <DriverPhotoUpload
              companyId={companyId}
              driverId={driver.id}
              photoStoragePath={photoStoragePath}
              onPhotoPathChange={(path) => void handlePhotoPathChange(path)}
              title="Foto do motorista nesta OS"
              hint="Envie ou troque a foto do motorista designado. Ela fica salva no cadastro e aparece no voucher de Transporte/Frete abaixo."
            />
          ) : (
            <Alert variant="warning">
              Designe um motorista na OS para poder enviar a foto no voucher.
            </Alert>
          )}
        </div>
      ) : null}

      <ServiceOrderDriverVoucherView
        order={order}
        context={context}
        pendingDriverAcceptance={pendingAcceptance}
      />
    </div>
  );
}
