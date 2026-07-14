import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSegmentsForOrder,
  type ScheduleOrderInput,
  type ScheduleSegment,
  weekDayKeys,
} from "@/lib/vehicle-schedule";

export type VehicleScheduleRow = {
  id: string;
  plate: string;
  model: string | null;
  vehicle_category: string;
};

export async function fetchVehicleScheduleData(
  supabase: SupabaseClient,
  companyId: string,
  weekAnchor: Date,
  options?: { vehicleId?: string | null; serviceType?: string | null }
): Promise<{
  vehicles: VehicleScheduleRow[];
  segments: ScheduleSegment[];
  weekKeys: string[];
  error: string | null;
}> {
  const weekKeys = weekDayKeys(weekAnchor);
  const rangeStart = weekKeys[0];
  const rangeEnd = weekKeys[6];

  let vehicleQuery = supabase
    .from("vehicles")
    .select("id, plate, plate_display, model, vehicle_category, status")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .neq("status", "Inativo")
    .order("plate");

  if (options?.vehicleId) {
    vehicleQuery = vehicleQuery.eq("id", options.vehicleId);
  }

  const { data: vehiclesRaw, error: vehicleError } = await vehicleQuery;
  if (vehicleError) {
    return { vehicles: [], segments: [], weekKeys, error: vehicleError.message };
  }

  const vehicles: VehicleScheduleRow[] = (vehiclesRaw ?? []).map((v) => ({
    id: v.id as string,
    plate: ((v.plate_display as string) || (v.plate as string) || "").toUpperCase(),
    model: (v.model as string | null) ?? null,
    vehicle_category: (v.vehicle_category as string) || "—",
  }));

  const orderMap = new Map<string, ScheduleOrderInput>();

  const addOrders = (rows: ScheduleOrderInput[] | null) => {
    for (const row of rows ?? []) {
      if (row.vehicle_id && row.status !== "Cancelado") {
        orderMap.set(row.id, row);
      }
    }
  };

  const orderSelect =
    "id, code, client_name, service_type, status, service_date, entry_date, entry_time, exit_date, exit_time, vehicle_id, freight_origin_address, freight_destination_address";

  let q1 = supabase
    .from("service_orders")
    .select(orderSelect)
    .eq("company_id", companyId)
    .neq("status", "Cancelado")
    .not("vehicle_id", "is", null)
    .lte("service_date", rangeEnd)
    .gte("service_date", rangeStart);

  if (options?.vehicleId) q1 = q1.eq("vehicle_id", options.vehicleId);
  if (options?.serviceType) q1 = q1.eq("service_type", options.serviceType);

  const { data: byServiceDate, error: orderError } = await q1;
  if (orderError) {
    return { vehicles, segments: [], weekKeys, error: orderError.message };
  }
  addOrders(byServiceDate as ScheduleOrderInput[]);

  let q2 = supabase
    .from("service_orders")
    .select(orderSelect)
    .eq("company_id", companyId)
    .neq("status", "Cancelado")
    .not("vehicle_id", "is", null)
    .not("entry_date", "is", null)
    .lte("entry_date", rangeEnd)
    .gte("entry_date", rangeStart);

  if (options?.vehicleId) q2 = q2.eq("vehicle_id", options.vehicleId);
  if (options?.serviceType) q2 = q2.eq("service_type", options.serviceType);

  const { data: byEntryDate } = await q2;
  addOrders(byEntryDate as ScheduleOrderInput[]);

  let q3 = supabase
    .from("service_orders")
    .select(orderSelect)
    .eq("company_id", companyId)
    .neq("status", "Cancelado")
    .not("vehicle_id", "is", null)
    .not("entry_date", "is", null)
    .not("exit_date", "is", null)
    .lte("entry_date", rangeEnd)
    .gte("exit_date", rangeStart);

  if (options?.vehicleId) q3 = q3.eq("vehicle_id", options.vehicleId);
  if (options?.serviceType) q3 = q3.eq("service_type", options.serviceType);

  const { data: spanning } = await q3;
  addOrders(spanning as ScheduleOrderInput[]);

  const segments: ScheduleSegment[] = [];
  for (const order of orderMap.values()) {
    segments.push(...buildSegmentsForOrder(order, weekKeys));
  }

  return {
    vehicles,
    segments,
    weekKeys,
    error: null,
  };
}
