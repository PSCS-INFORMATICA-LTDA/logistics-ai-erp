import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWhatsAppShareLinks, getPublicAppOrigin } from "@/lib/service-order-proposal";
import { formatCurrency } from "@/lib/utils";

export type PatioTicketSource = "parking" | "car_wash";

export type PublicPatioTicketPayload = {
  found: boolean;
  kind?: "estacionamento" | "lava-rapido";
  company_name?: string;
  company_document?: string | null;
  ticket?: Record<string, unknown>;
};

export async function ensurePatioTicketToken(
  supabase: SupabaseClient,
  source: PatioTicketSource,
  id: string
): Promise<{ token: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("ensure_patio_ticket_token", {
    p_source: source,
    p_id: id,
  });
  if (error) {
    if (/ensure_patio_ticket_token|function .* does not exist|public_ticket_token/i.test(error.message)) {
      return {
        token: null,
        error:
          "Banco sem ticket público. Rode frontend/scripts/apply-062-patio-public-ticket.sql no Supabase.",
      };
    }
    return { token: null, error: error.message };
  }
  const token = typeof data === "string" ? data : null;
  if (!token) return { token: null, error: "Não foi possível gerar o link do ticket." };
  return { token, error: null };
}

export async function fetchPublicPatioTicket(
  supabase: SupabaseClient,
  token: string
): Promise<{ data: PublicPatioTicketPayload | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_public_patio_ticket", {
    p_token: token,
  });
  if (error) {
    if (/get_public_patio_ticket|function .* does not exist/i.test(error.message)) {
      return {
        data: null,
        error:
          "Banco sem ticket público. Rode frontend/scripts/apply-062-patio-public-ticket.sql no Supabase.",
      };
    }
    return { data: null, error: error.message };
  }
  return { data: (data as PublicPatioTicketPayload) ?? { found: false }, error: null };
}

export function patioTicketPublicUrl(token: string): string {
  return `${getPublicAppOrigin()}/ticket/${token}`;
}

export function buildPatioTicketWhatsAppMessage(params: {
  kind: "estacionamento" | "lava-rapido";
  companyName: string;
  code: string;
  plate: string;
  totalAmount?: number | null;
  publicUrl: string;
}): string {
  const title =
    params.kind === "estacionamento" ? "Comprovante Estacionamento" : "Comprovante Lava-rápido";
  const total =
    params.totalAmount != null && Number.isFinite(params.totalAmount)
      ? formatCurrency(params.totalAmount)
      : "—";
  return [
    `*${title} — ${params.companyName}*`,
    `Placa: ${params.plate}`,
    `Código: ${params.code}`,
    `Total: ${total}`,
    "",
    "Apresente este link (ou o QR) na saída/retirada:",
    params.publicUrl,
  ].join("\n");
}

export function buildPatioTicketWhatsAppShare(params: {
  kind: "estacionamento" | "lava-rapido";
  companyName: string;
  code: string;
  plate: string;
  phone?: string | null;
  totalAmount?: number | null;
  publicUrl: string;
}) {
  const message = buildPatioTicketWhatsAppMessage(params);
  return {
    message,
    links: buildWhatsAppShareLinks(message, params.phone),
  };
}
