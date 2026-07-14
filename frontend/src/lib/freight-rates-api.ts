import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeVehicleCategory,
  type FreightRateModality,
  type FreightRateRow,
} from "@/lib/freight-rates";

export async function seedFreightRateDefaults(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { error } = await supabase.rpc("seed_freight_rate_defaults", {
    p_company_id: companyId,
  });
  return error?.message ?? null;
}

export async function listFreightRates(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rows: FreightRateRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("freight_rate_tables")
    .select("*")
    .eq("company_id", companyId)
    .order("modality")
    .order("vehicle_category")
    .order("valid_from", { ascending: false });
  if (error) return { rows: [], error: error.message };
  return { rows: (data as FreightRateRow[]) ?? [], error: null };
}

export async function resolveFreightRate(params: {
  supabase: SupabaseClient;
  companyId: string;
  modality: FreightRateModality;
  vehicleCategory: string | null | undefined;
  onDate: string;
}): Promise<
  | { ratePerKm: number; roundTripFromKm: number; code: string }
  | { error: string }
> {
  const category = normalizeVehicleCategory(params.vehicleCategory);
  const { data, error } = await params.supabase
    .from("freight_rate_tables")
    .select("code, rate_per_km, round_trip_from_km, valid_from, valid_until")
    .eq("company_id", params.companyId)
    .eq("modality", params.modality)
    .eq("vehicle_category", category)
    .eq("status", "Ativo")
    .lte("valid_from", params.onDate)
    .order("valid_from", { ascending: false })
    .limit(20);

  if (error) return { error: error.message };
  const rows =
    (data as Array<{
      code: string;
      rate_per_km: number;
      round_trip_from_km: number;
      valid_from: string;
      valid_until: string | null;
    }>) ?? [];

  const match = rows.find((r) => !r.valid_until || r.valid_until >= params.onDate);
  if (match) {
    return {
      ratePerKm: Number(match.rate_per_km),
      roundTripFromKm: Number(match.round_trip_from_km),
      code: match.code,
    };
  }

  const { data: fallback } = await params.supabase
    .from("freight_rate_tables")
    .select("code, rate_per_km, round_trip_from_km, valid_from, valid_until")
    .eq("company_id", params.companyId)
    .eq("modality", params.modality)
    .eq("status", "Ativo")
    .lte("valid_from", params.onDate)
    .order("valid_from", { ascending: false })
    .limit(20);
  const fb = ((fallback as typeof rows) ?? []).find(
    (r) => !r.valid_until || r.valid_until >= params.onDate
  );
  if (!fb) {
    return {
      error: `Sem tarifa vigente para ${params.modality} / ${category}. Cadastre em Parâmetros de frete.`,
    };
  }
  return {
    ratePerKm: Number(fb.rate_per_km),
    roundTripFromKm: Number(fb.round_trip_from_km),
    code: fb.code,
  };
}
