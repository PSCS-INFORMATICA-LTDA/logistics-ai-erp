import type { SupabaseClient } from "@supabase/supabase-js";

export type WhatsAppReferenceType =
  | "service_order_proposal"
  | "driver_assignment"
  | "car_wash_ready"
  | "patio_ticket"
  | "other";

/**
 * Registra somente whatsapp_open_requested (não marca mensagem como enviada).
 */
export async function logWhatsAppOpenRequested(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    userId: string | null;
    phone: string;
    referenceType: WhatsAppReferenceType;
    referenceId: string;
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("whatsapp_open_events").insert({
    company_id: params.companyId,
    user_id: params.userId,
    phone: params.phone,
    reference_type: params.referenceType,
    reference_id: params.referenceId,
    event_type: "whatsapp_open_requested",
    occurred_at: new Date().toISOString(),
  });

  if (!error) return { error: null };

  if (/whatsapp_open_events|does not exist|schema cache/i.test(error.message)) {
    return {
      error:
        "Banco sem log de WhatsApp. Rode frontend/scripts/apply-064-whatsapp-open-events.sql no Supabase.",
    };
  }
  return { error: error.message };
}
