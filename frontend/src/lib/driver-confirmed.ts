/**
 * Contrato único DRIVER_CONFIRMED.
 * UI, «Confirmar sem link», designação pública e complete_service_order
 * usam exatamente esta regra:
 * driver_id definido E driver_assignment_response = 'accepted'.
 *
 * Espelho SQL: public.service_order_driver_confirmed (migration 080).
 */
export type DriverConfirmedInput = {
  driver_id?: string | null;
  driver_assignment_response?: string | null;
};

export function isCanonicalDriverConfirmed(row: DriverConfirmedInput): boolean {
  return Boolean(row.driver_id) && row.driver_assignment_response === "accepted";
}
