import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildWhatsAppShareLinks,
  copyTextToClipboard,
  formatServiceDate,
  generateProposalQrDataUrl,
  getPublicAppOrigin,
  isWindowsWhatsAppDesktop,
  openEmailShare,
  resolveProposalAmount,
} from "@/lib/service-order-proposal";
import { fetchBrandLogoDataUrl } from "@/lib/brand-email";
import { formatCurrency } from "@/lib/utils";
import { SERVICE_ORDER_TYPE_LABELS, type ServiceOrder } from "@/types/database";

export type DriverAssignmentResponse = "pending" | "accepted" | "rejected";

export type PublicDriverAssignmentPayload = {
  found: boolean;
  company_name?: string;
  driver_name?: string | null;
  driver_assignment_response?: DriverAssignmentResponse;
  driver_assignment_sent_at?: string | null;
  can_respond?: boolean;
  order?: Pick<
    ServiceOrder,
    | "code"
    | "service_type"
    | "service_date"
    | "plate"
    | "client_name"
    | "freight_origin_address"
    | "freight_destination_address"
    | "freight_agreed_amount"
    | "service_amount"
  >;
};

export function buildPublicDriverAssignmentUrl(token: string): string {
  const origin = getPublicAppOrigin();
  return `${origin}/designacao/${token}`;
}

export type DriverAssignmentOrderSummary = Pick<
  ServiceOrder,
  | "code"
  | "service_type"
  | "service_date"
  | "plate"
  | "client_name"
  | "freight_origin_address"
  | "freight_destination_address"
  | "freight_distance_km"
  | "freight_agreed_amount"
  | "service_amount"
>;

const DRIVER_ASSIGNMENT_INTRO =
  "Segue a designação da ordem de serviço para sua confirmação.";
const DRIVER_ASSIGNMENT_CLOSING =
  "Por favor, acesse o link abaixo e confirme se aceita ou recusa esta corrida.";
const DRIVER_ASSIGNMENT_EMAIL_QR_HINT =
  "Escaneie o QR Code abaixo para abrir a designação no celular.";
const DRIVER_ASSIGNMENT_EMAIL_SIGNOFF = [
  "Fico no aguardo da sua confirmação,",
  "Obrigado!",
] as const;
const DRIVER_GREETING_BREAK = "\n\n\n";

function formatDriverGreetingName(driverName: string): string {
  const first = driverName.trim().split(/\s+/)[0];
  return first || driverName;
}

function buildDriverAssignmentGreeting(driverName: string): string {
  const firstName = formatDriverGreetingName(driverName);
  return `Olá, ${firstName},${DRIVER_GREETING_BREAK}Tudo bem?${DRIVER_GREETING_BREAK}${DRIVER_ASSIGNMENT_INTRO}`;
}

function appendDriverAssignmentOrderDetails(
  lines: string[],
  order: DriverAssignmentOrderSummary,
  options?: { boldRoute?: boolean }
): void {
  const amount = resolveProposalAmount(order as ServiceOrder);
  const routeLabel = options?.boldRoute ? "*Rota*" : "Rota";

  lines.push(
    "",
    `OS ${order.code}`,
    `Cliente: ${order.client_name ?? "—"}`,
    `Tipo: ${SERVICE_ORDER_TYPE_LABELS[order.service_type] ?? order.service_type}`,
    `Data: ${formatServiceDate(order.service_date)}`,
    `Placa: ${order.plate ?? "—"}`
  );

  if (order.freight_origin_address || order.freight_destination_address) {
    lines.push(
      "",
      routeLabel,
      `A: ${order.freight_origin_address ?? "—"}`,
      `B: ${order.freight_destination_address ?? "—"}`
    );
    if (order.freight_distance_km) {
      lines.push(`Distância: ${order.freight_distance_km} km`);
    }
  }

  if (amount != null) {
    lines.push(
      "",
      options?.boldRoute ? `*Valor: ${formatCurrency(amount)}*` : `Valor: ${formatCurrency(amount)}`
    );
  }
}

function appendDriverAssignmentClosingWithLink(lines: string[], assignmentUrl: string): void {
  lines.push("", DRIVER_ASSIGNMENT_CLOSING);
  const url = assignmentUrl.trim();
  if (url) lines.push("", url);
}

export function buildDriverAssignmentWhatsAppText(
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string
): string {
  const lines = [
    buildDriverAssignmentGreeting(driverName),
    "",
    `*Designação OS ${order.code}* — ${companyName}`,
  ];

  appendDriverAssignmentOrderDetails(lines, order, { boldRoute: true });
  appendDriverAssignmentClosingWithLink(lines, assignmentUrl);
  lines.push("", "GRX Transportes e Logística");

  return lines.join("\n");
}

export function buildDriverAssignmentEmailBody(
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string
): string {
  const lines = [
    buildDriverAssignmentGreeting(driverName),
    "",
    `Designação OS ${order.code} — ${companyName}`,
  ];

  appendDriverAssignmentOrderDetails(lines, order);
  appendDriverAssignmentClosingWithLink(lines, assignmentUrl);
  lines.push(
    "",
    DRIVER_ASSIGNMENT_EMAIL_QR_HINT,
    "",
    ...DRIVER_ASSIGNMENT_EMAIL_SIGNOFF,
    "",
    "GRX Transportes e Logística"
  );

  return lines.join("\n");
}

export async function openDriverAssignmentEmailShare(
  driverEmail: string,
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string
): Promise<void> {
  const body = buildDriverAssignmentEmailBody(order, companyName, driverName, assignmentUrl);
  const subject = `Designação OS ${order.code} — ${companyName}`;
  const [qrDataUrl, logoDataUrl] = await Promise.all([
    generateProposalQrDataUrl(assignmentUrl),
    fetchBrandLogoDataUrl(),
  ]);

  await openEmailShare(subject, body, assignmentUrl, {
    to: driverEmail,
    qrDataUrl,
    logoDataUrl,
    companyName,
  });
}

export async function sendDriverAssignment(
  supabase: SupabaseClient,
  orderId: string,
  driverId: string
): Promise<{
  token: string | null;
  sentAt: string | null;
  proposedDriverId: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("send_driver_assignment", {
    p_order_id: orderId,
    p_driver_id: driverId,
  });

  if (error) {
    return { token: null, sentAt: null, proposedDriverId: null, error: error.message };
  }

  const payload = data as {
    token?: string;
    driver_assignment_sent_at?: string;
    proposed_driver_id?: string;
  } | null;

  return {
    token: payload?.token ?? null,
    sentAt: payload?.driver_assignment_sent_at ?? null,
    proposedDriverId: payload?.proposed_driver_id ?? driverId,
    error: null,
  };
}

export async function fetchPublicDriverAssignment(
  supabase: SupabaseClient,
  token: string
): Promise<{ data: PublicDriverAssignmentPayload | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_public_driver_assignment", {
    p_token: token,
  });

  if (error) return { data: null, error: error.message };
  return { data: data as PublicDriverAssignmentPayload, error: null };
}

export async function respondToDriverAssignment(
  supabase: SupabaseClient,
  token: string,
  action: "accept" | "reject"
): Promise<{
  driverAssignmentResponse: DriverAssignmentResponse | null;
  driverId: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("respond_to_driver_assignment", {
    p_token: token,
    p_action: action,
  });

  if (error) {
    return { driverAssignmentResponse: null, driverId: null, error: error.message };
  }

  const payload = data as {
    driver_assignment_response?: DriverAssignmentResponse;
    driver_id?: string;
  } | null;

  return {
    driverAssignmentResponse: payload?.driver_assignment_response ?? null,
    driverId: payload?.driver_id ?? null,
    error: null,
  };
}

export async function shareDriverAssignmentViaWhatsApp(
  text: string,
  phone?: string | null
): Promise<void> {
  const links = buildWhatsAppShareLinks(text, phone);
  await copyTextToClipboard(text);
  window.open(links.primaryHref, "_blank", "noopener,noreferrer");
  if (isWindowsWhatsAppDesktop()) {
    window.alert(
      "Mensagem copiada. Se o WhatsApp não abrir sozinho, use Alt+Tab nele e Ctrl+V no chat do motorista."
    );
  }
}

export const DRIVER_ASSIGNMENT_RESPONSE_LABELS: Record<DriverAssignmentResponse, string> = {
  pending: "Aguardando confirmação do motorista",
  accepted: "Motorista confirmado",
  rejected: "Designação recusada pelo motorista",
};
