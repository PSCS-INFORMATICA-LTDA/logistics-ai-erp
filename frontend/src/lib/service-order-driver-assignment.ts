import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatServiceDate,
  getPublicAppOrigin,
  isWindowsWhatsAppDesktop,
  prepareEmailShareBundle,
  buildWhatsAppShareLinks,
  type EmailShareBundle,
  type WhatsAppShareLinks,
} from "@/lib/service-order-proposal";
import { formatCurrency } from "@/lib/utils";
import { SERVICE_ORDER_TYPE_LABELS, type ServiceOrder } from "@/types/database";

export type DriverAssignmentResponse = "pending" | "accepted" | "rejected";

export type PublicDriverAssignmentPayload = {
  found: boolean;
  company_name?: string;
  driver_name?: string | null;
  driver_assignment_response?: DriverAssignmentResponse;
  driver_assignment_sent_at?: string | null;
  driver_assignment_pay_amount?: number | null;
  driver_assignment_assistant_pay_amount?: number | null;
  can_respond?: boolean;
  order?: Pick<
    ServiceOrder,
    | "code"
    | "service_type"
    | "service_date"
    | "entry_date"
    | "entry_time"
    | "exit_date"
    | "exit_time"
    | "plate"
    | "client_name"
    | "freight_origin_address"
    | "freight_destination_address"
    | "freight_distance_km"
    | "freight_agreed_amount"
    | "freight_toll_amount"
    | "service_amount"
  >;
};

export type DriverAssignmentPayDetails = {
  driverPayAmount: number;
  assistantPayAmount?: number | null;
};

export function parseBrazilianMoneyInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoneyInputValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value).replace(".", ",");
}

export function buildPublicDriverAssignmentUrl(token: string): string {
  const origin = getPublicAppOrigin();
  return `${origin}/designacao/${token}`;
}

export type DriverAssignmentOrderSummary = Pick<
  ServiceOrder,
  | "code"
  | "service_type"
  | "service_date"
  | "entry_date"
  | "entry_time"
  | "exit_date"
  | "exit_time"
  | "plate"
  | "client_name"
  | "freight_origin_address"
  | "freight_destination_address"
  | "freight_distance_km"
  | "freight_toll_amount"
>;

export type DriverScheduleSource = "recorded" | "fallback" | "missing";

export type DriverAssignmentSchedule = {
  serviceDate: string | null;
  departureDate: string | null;
  departureTime: string | null;
  presentationDate: string | null;
  presentationTime: string | null;
  presentationSource: DriverScheduleSource;
};

const PRESENTATION_LEAD_MINUTES = 30;

function civilDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function clockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClock(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function shiftCivilDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Data e hora exibidas no card público e no WhatsApp. Não grava nada. */
export function formatDriverScheduleMoment(
  date: string | null,
  time: string | null,
): string {
  const day = date ? formatServiceDate(date) : null;
  if (day && day !== "—" && time) return `${day} ${time}`;
  if (time) return time;
  if (day && day !== "—") return day;
  return "—";
}

/**
 * Apresentação oficial: entry_date/entry_time.
 * Sem apresentação cadastrada, a tela calcula 30 minutos antes da saída.
 */
export function resolveDriverAssignmentSchedule(input: {
  serviceDate?: string | null;
  entryDate?: string | null;
  entryTime?: string | null;
  exitDate?: string | null;
  exitTime?: string | null;
}): DriverAssignmentSchedule {
  const serviceDate = civilDate(input.serviceDate);
  const entryDate = civilDate(input.entryDate);
  const exitDate = civilDate(input.exitDate);
  const entryTime = clockMinutes(input.entryTime);
  const exitTime = clockMinutes(input.exitTime);
  const departureDate = exitTime == null ? null : exitDate ?? serviceDate;

  if (entryTime != null) {
    return {
      serviceDate,
      departureDate,
      departureTime: exitTime == null ? null : formatClock(exitTime),
      presentationDate: entryDate ?? serviceDate ?? exitDate,
      presentationTime: formatClock(entryTime),
      presentationSource: "recorded",
    };
  }

  if (exitTime != null) {
    const raw = exitTime - PRESENTATION_LEAD_MINUTES;
    const baseDate = exitDate ?? serviceDate;
    return {
      serviceDate,
      departureDate,
      departureTime: formatClock(exitTime),
      presentationDate: baseDate && raw < 0 ? shiftCivilDate(baseDate, -1) : baseDate,
      presentationTime: formatClock(raw),
      presentationSource: "fallback",
    };
  }

  return {
    serviceDate,
    departureDate: null,
    departureTime: null,
    presentationDate: null,
    presentationTime: null,
    presentationSource: "missing",
  };
}

const DRIVER_ASSIGNMENT_INTRO =
  "Segue a designação da ordem de serviço para sua confirmação.";
const DRIVER_ASSIGNMENT_CLOSING =
  "Por favor, acesse o link abaixo e confirme se aceita ou recusa esta corrida.";
const DRIVER_ASSIGNMENT_EMAIL_SIGNOFF = [
  "Fico no aguardo da sua confirmação,",
  "Obrigado!",
] as const;
const DRIVER_GREETING_BREAK = "\n\n\n";

function formatDriverGreetingName(driverName: string): string {
  const first = driverName.trim().split(/\s+/)[0];
  return first || driverName;
}

function buildDriverAssignmentGreeting(driverName: string, compact = false): string {
  const firstName = formatDriverGreetingName(driverName);
  const breakLine = compact ? "\n" : DRIVER_GREETING_BREAK;
  return `Olá, ${firstName},${breakLine}Tudo bem?${breakLine}${DRIVER_ASSIGNMENT_INTRO}`;
}

function appendDriverAssignmentPayDetails(
  lines: string[],
  payDetails: DriverAssignmentPayDetails,
  options?: { bold?: boolean }
): void {
  const bold = options?.bold ?? false;
  const driverLine = bold
    ? `*Valor do serviço (motorista): ${formatCurrency(payDetails.driverPayAmount)}*`
    : `Valor do serviço (motorista): ${formatCurrency(payDetails.driverPayAmount)}`;

  lines.push("", bold ? "*Pagamento*" : "Pagamento", driverLine);

  const assistant = payDetails.assistantPayAmount;
  if (assistant != null && assistant > 0) {
    lines.push(`Valor do ajudante: ${formatCurrency(assistant)}`);
    lines.push(
      bold
        ? `*Total: ${formatCurrency(payDetails.driverPayAmount + assistant)}*`
        : `Total: ${formatCurrency(payDetails.driverPayAmount + assistant)}`
    );
  }
}

function appendDriverAssignmentOrderDetails(
  lines: string[],
  order: DriverAssignmentOrderSummary,
  payDetails: DriverAssignmentPayDetails,
  options?: { boldRoute?: boolean }
): void {
  const routeLabel = options?.boldRoute ? "*Rota*" : "Rota";
  const schedule = resolveDriverAssignmentSchedule({
    serviceDate: order.service_date,
    entryDate: order.entry_date,
    entryTime: order.entry_time,
    exitDate: order.exit_date,
    exitTime: order.exit_time,
  });

  lines.push(
    "",
    `OS ${order.code}`,
    `Cliente: ${order.client_name ?? "—"}`,
    `Tipo: ${SERVICE_ORDER_TYPE_LABELS[order.service_type] ?? order.service_type}`,
    `Data: ${formatServiceDate(order.service_date)}`,
    `Saída prevista: ${formatDriverScheduleMoment(schedule.departureDate, schedule.departureTime)}`,
    `Horário de apresentação: ${formatDriverScheduleMoment(schedule.presentationDate, schedule.presentationTime)}`,
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
    if (order.freight_toll_amount) {
      lines.push(`Pedágio: ${formatCurrency(order.freight_toll_amount)}`);
    }
  }

  appendDriverAssignmentPayDetails(lines, payDetails, {
    bold: options?.boldRoute,
  });
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
  assignmentUrl: string,
  payDetails: DriverAssignmentPayDetails,
  options?: { compact?: boolean }
): string {
  const compact = options?.compact ?? false;
  const lines = [
    buildDriverAssignmentGreeting(driverName, compact),
    "",
    `*Designação OS ${order.code}* — ${companyName}`,
  ];

  appendDriverAssignmentOrderDetails(lines, order, payDetails, { boldRoute: true });
  appendDriverAssignmentClosingWithLink(lines, assignmentUrl);
  lines.push("", "GRX Transportes e Logística");

  return lines.join("\n");
}

export function buildDriverAssignmentWhatsAppUrlText(
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string,
  payDetails: DriverAssignmentPayDetails
): string {
  return buildDriverAssignmentWhatsAppText(
    order,
    companyName,
    driverName,
    assignmentUrl,
    payDetails,
    { compact: true }
  );
}

export function buildDriverAssignmentEmailBody(
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string,
  payDetails: DriverAssignmentPayDetails
): string {
  const lines = [
    buildDriverAssignmentGreeting(driverName),
    "",
    `Designação OS ${order.code} — ${companyName}`,
  ];

  appendDriverAssignmentOrderDetails(lines, order, payDetails);
  appendDriverAssignmentClosingWithLink(lines, assignmentUrl);
  lines.push("", ...DRIVER_ASSIGNMENT_EMAIL_SIGNOFF, "", "GRX Transportes e Logística");

  return lines.join("\n");
}

export async function prepareDriverAssignmentEmailBundle(
  driverEmail: string,
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string,
  payDetails: DriverAssignmentPayDetails
): Promise<EmailShareBundle> {
  const body = buildDriverAssignmentEmailBody(
    order,
    companyName,
    driverName,
    assignmentUrl,
    payDetails
  );
  const subject = `Designação OS ${order.code} — ${companyName}`;

  return prepareEmailShareBundle(subject, body, assignmentUrl, {
    to: driverEmail,
    companyName,
  });
}

/** @deprecated Use prepareDriverAssignmentEmailBundle + launchPreparedEmailShare on user click. */
export async function openDriverAssignmentEmailShare(
  driverEmail: string,
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string,
  payDetails: DriverAssignmentPayDetails
) {
  const bundle = await prepareDriverAssignmentEmailBundle(
    driverEmail,
    order,
    companyName,
    driverName,
    assignmentUrl,
    payDetails
  );
  const { launchPreparedEmailShare } = await import("@/lib/service-order-proposal");
  return launchPreparedEmailShare(bundle, {
    copiedAlertMessage:
      "Designação copiada (texto, link, QR Code e logo GRX).\n\n1. O e-mail abrirá com assunto e texto.\n2. Clique no corpo do e-mail e pressione Ctrl+V para colar QR Code e logo.",
  });
}

export type DriverAssignmentSharePayload = {
  assignmentUrl: string;
  whatsappMessage: string;
  whatsappLinks: WhatsAppShareLinks;
  emailBundle: EmailShareBundle | null;
};

export async function prepareDriverAssignmentSharePayload(
  driverEmail: string | null | undefined,
  order: DriverAssignmentOrderSummary,
  companyName: string,
  driverName: string,
  assignmentUrl: string,
  payDetails: DriverAssignmentPayDetails,
  driverPhone?: string | null
): Promise<DriverAssignmentSharePayload> {
  const whatsappMessage = buildDriverAssignmentWhatsAppText(
    order,
    companyName,
    driverName,
    assignmentUrl,
    payDetails
  );
  const urlMessage = buildDriverAssignmentWhatsAppUrlText(
    order,
    companyName,
    driverName,
    assignmentUrl,
    payDetails
  );
  const whatsappLinks = {
    ...buildWhatsAppShareLinks(urlMessage, driverPhone, { recipient: "motorista" }),
    // URL nativa usa texto compacto; clipboard/painel guardam a mensagem completa.
    message: whatsappMessage,
  };

  let emailBundle: EmailShareBundle | null = null;
  if (driverEmail?.trim()) {
    emailBundle = await prepareDriverAssignmentEmailBundle(
      driverEmail.trim(),
      order,
      companyName,
      driverName,
      assignmentUrl,
      payDetails
    );
  }

  return {
    assignmentUrl,
    whatsappMessage,
    whatsappLinks,
    emailBundle,
  };
}

export async function ensureDriverAssignmentToken(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ token: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("ensure_driver_assignment_token", {
    p_order_id: orderId,
  });

  if (error) return { token: null, error: error.message };
  return { token: (data as string | null) ?? null, error: null };
}

export async function resetDriverAssignment(
  supabase: SupabaseClient,
  orderId: string
): Promise<{
  driverAssignmentResponse: DriverAssignmentResponse | null;
  proposedDriverId: string | null;
  sentAt: string | null;
  driverId: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("reset_driver_assignment", {
    p_order_id: orderId,
  });

  if (error) {
    return {
      driverAssignmentResponse: null,
      proposedDriverId: null,
      sentAt: null,
      driverId: null,
      error: error.message,
    };
  }

  const payload = data as {
    driver_assignment_response?: DriverAssignmentResponse;
    proposed_driver_id?: string | null;
    driver_assignment_sent_at?: string | null;
    driver_id?: string | null;
  } | null;

  return {
    driverAssignmentResponse: payload?.driver_assignment_response ?? "pending",
    proposedDriverId: payload?.proposed_driver_id ?? null,
    sentAt: payload?.driver_assignment_sent_at ?? null,
    driverId: payload?.driver_id ?? null,
    error: null,
  };
}

export async function sendDriverAssignment(
  supabase: SupabaseClient,
  orderId: string,
  driverId: string,
  payDetails: DriverAssignmentPayDetails
): Promise<{
  token: string | null;
  sentAt: string | null;
  proposedDriverId: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("send_driver_assignment", {
    p_order_id: orderId,
    p_driver_id: driverId,
    p_driver_pay_amount: payDetails.driverPayAmount,
    p_assistant_pay_amount: payDetails.assistantPayAmount ?? null,
  });

  if (error) {
    const message = error.message.includes("send_driver_assignment")
      ? "Função send_driver_assignment desatualizada no Supabase. Rode o script apply-all-driver-designation-flow.sql no SQL Editor do Supabase."
      : error.message;
    return { token: null, sentAt: null, proposedDriverId: null, error: message };
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
  proposedDriverId: string | null;
  rejectedDriverIds: string[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("respond_to_driver_assignment", {
    p_token: token,
    p_action: action,
  });

  if (error) {
    return {
      driverAssignmentResponse: null,
      driverId: null,
      proposedDriverId: null,
      rejectedDriverIds: [],
      error: error.message,
    };
  }

  const payload = data as {
    driver_assignment_response?: DriverAssignmentResponse;
    driver_id?: string;
    proposed_driver_id?: string;
    driver_assignment_rejected_driver_ids?: string[];
  } | null;

  return {
    driverAssignmentResponse: payload?.driver_assignment_response ?? null,
    driverId: payload?.driver_id ?? null,
    proposedDriverId: payload?.proposed_driver_id ?? null,
    rejectedDriverIds: payload?.driver_assignment_rejected_driver_ids ?? [],
    error: null,
  };
}

export async function shareDriverAssignmentViaWhatsApp(
  text: string,
  phone?: string | null,
  options?: { preOpenedWindow?: Window | null; urlText?: string; skipCopy?: boolean }
): Promise<boolean> {
  const { shareViaWhatsAppPrepared } = await import("@/lib/service-order-proposal");
  const urlMessage = options?.urlText ?? text;
  const result = await shareViaWhatsAppPrepared(urlMessage, text, phone, {
    preOpenedWindow: options?.preOpenedWindow,
    skipCopy: options?.skipCopy,
    copiedHint: isWindowsWhatsAppDesktop()
      ? "Mensagem copiada. Se o WhatsApp não abrir com o texto, use Alt+Tab nele e Ctrl+V no chat do motorista."
      : "Mensagem copiada. Confira o chat do motorista e pressione Enter. Use Ctrl+V se o texto não aparecer.",
  });
  return result.copied;
}

export const DRIVER_ASSIGNMENT_RESPONSE_LABELS: Record<DriverAssignmentResponse, string> = {
  pending: "Aguardando confirmação do motorista",
  accepted: "Motorista confirmado",
  rejected: "Designação recusada pelo motorista",
};
