import type { SupabaseClient } from "@supabase/supabase-js";

export type ConfirmDriverWithoutLinkPay = {
  driverPayAmount?: number | null;
  assistantPayAmount?: number | null;
};

/**
 * «Confirmar sem link» grava o mesmo aceite canônico da designação pública:
 * driver_id + proposed_driver_id + driver_assignment_response = accepted.
 */
export async function assignServiceOrderDriver(
  supabase: SupabaseClient,
  orderId: string,
  driverId: string,
  pay?: ConfirmDriverWithoutLinkPay | null
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("confirm_service_order_driver_without_link", {
    p_order_id: orderId,
    p_driver_id: driverId,
    p_driver_pay_amount: pay?.driverPayAmount ?? null,
    p_assistant_pay_amount: pay?.assistantPayAmount ?? null,
  });

  if (error) {
    const message = error.message.includes("confirm_service_order_driver_without_link")
      ? "Função confirm_service_order_driver_without_link não encontrada no Supabase. Aplique a migration 080_canonical_driver_confirmed.sql no DEV."
      : error.message;
    return { error: message };
  }
  return { error: null };
}
