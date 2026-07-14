/** Cadastro mestre de tarifas R$/km (Frete / Transporte). */

export const FREIGHT_RATE_MODALITIES = ["Frete", "Transporte"] as const;
export type FreightRateModality = (typeof FREIGHT_RATE_MODALITIES)[number];

export const FREIGHT_RATE_VEHICLE_CATEGORIES = [
  "Van",
  "Onibus",
  "Caminhao",
  "MicroOnibus",
  "Outro",
] as const;
export type FreightRateVehicleCategory = (typeof FREIGHT_RATE_VEHICLE_CATEGORIES)[number];

export const DEFAULT_ROUND_TRIP_FROM_KM = 500;

export type FreightRateRow = {
  id: string;
  company_id: string;
  code: string;
  modality: FreightRateModality | string;
  vehicle_category: FreightRateVehicleCategory | string;
  rate_per_km: number;
  round_trip_from_km: number;
  valid_from: string;
  valid_until: string | null;
  status: string;
  notes: string | null;
};

/** Distância cobrada: ida e volta quando km ≥ limiar. */
export function billableDistanceKm(
  distanceKm: number,
  roundTripFromKm: number = DEFAULT_ROUND_TRIP_FROM_KM
): { billableKm: number; isRoundTrip: boolean } {
  if (!distanceKm || distanceKm <= 0) return { billableKm: 0, isRoundTrip: false };
  if (roundTripFromKm > 0 && distanceKm >= roundTripFromKm) {
    return { billableKm: Math.round(distanceKm * 2 * 100) / 100, isRoundTrip: true };
  }
  return { billableKm: distanceKm, isRoundTrip: false };
}

export function estimateKmRevenue(
  distanceKm: number,
  ratePerKm: number,
  roundTripFromKm: number = DEFAULT_ROUND_TRIP_FROM_KM
): { amount: number; billableKm: number; isRoundTrip: boolean } {
  const { billableKm, isRoundTrip } = billableDistanceKm(distanceKm, roundTripFromKm);
  const amount =
    billableKm > 0 && ratePerKm > 0
      ? Math.round(billableKm * ratePerKm * 100) / 100
      : 0;
  return { amount, billableKm, isRoundTrip };
}

export function normalizeVehicleCategory(
  category: string | null | undefined
): FreightRateVehicleCategory {
  const value = String(category ?? "").trim();
  if ((FREIGHT_RATE_VEHICLE_CATEGORIES as readonly string[]).includes(value)) {
    return value as FreightRateVehicleCategory;
  }
  return "Outro";
}
