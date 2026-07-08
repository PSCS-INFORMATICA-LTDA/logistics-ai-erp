import { formatCurrency } from "@/lib/utils";
import { normalizePerDiemDetail, perDiemDayTotal, perDiemChargeLabel, isPerDiemClientCharge } from "@/lib/freight-per-diem";
import { SERVICE_ORDER_TYPE_LABELS } from "@/types/database";
import type { ServiceOrder } from "@/types/database";

export type ServiceOrderProposalContext = {
  companyName: string;
  driverName?: string | null;
  dreAccountName?: string | null;
};

export function formatServiceDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function resolveProposalAmount(order: ServiceOrder): number | null {
  return order.freight_agreed_amount ?? order.service_amount ?? null;
}

export function buildProposalUrl(orderId: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/operacional/ordens-servico/${orderId}/proposta`;
}

export function buildPublicProposalUrl(token: string, origin?: string): string {
  const base = origin ?? getPublicAppOrigin();
  return `${base.replace(/\/$/, "")}/proposta/${token}`;
}

/** URL enviada ao cliente — sempre produção, nunca localhost. */
export function resolveClientProposalShareUrl(
  token: string | null | undefined,
  fallbackUrl?: string | null
): string | null {
  if (token?.trim()) {
    return buildPublicProposalUrl(token.trim());
  }
  if (fallbackUrl?.trim()) {
    return sanitizePublicProposalUrl(fallbackUrl);
  }
  return null;
}

export function sanitizePublicProposalUrl(url: string): string {
  const trimmed = url.trim();
  const tokenMatch = trimmed.match(/\/proposta\/([a-f0-9]{32,})/i);
  if (tokenMatch?.[1]) {
    return buildPublicProposalUrl(tokenMatch[1]);
  }
  if (isLocalhostPublicProposalUrl(trimmed)) {
    return trimmed.replace(
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i,
      getPublicAppOrigin()
    );
  }
  return trimmed;
}

const DEFAULT_PUBLIC_APP_URL = "https://grx-management.vercel.app";

export function getPublicAppOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  if (typeof window !== "undefined") {
    const origin = window.location.origin.replace(/\/$/, "");
    if (isLocalhostOrigin(origin)) {
      return DEFAULT_PUBLIC_APP_URL;
    }
    return origin;
  }

  return DEFAULT_PUBLIC_APP_URL;
}

/** Origem para testar aceite/recusa no ambiente de desenvolvimento (PC ou celular na mesma rede). */
export function getProposalAcceptanceTestOrigin(): string {
  const devUrl = process.env.NEXT_PUBLIC_DEV_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (devUrl) return devUrl;

  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/$/, "").replace("://localhost", "://127.0.0.1");
  }

  return "http://127.0.0.1:3002";
}

/** Link para teste Aceitar/Recusar — no dev usa URL local/rede; em produção usa URL pública. */
export function resolveProposalAcceptanceTestUrl(
  token: string | null | undefined
): string | null {
  if (!token?.trim()) return null;
  if (process.env.NODE_ENV === "development") {
    return buildPublicProposalUrl(token.trim(), getProposalAcceptanceTestOrigin());
  }
  return resolveClientProposalShareUrl(token);
}

export function isLocalhostOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin.replace(/\/$/, ""));
}

export function isLocalhostPublicProposalUrl(url: string): boolean {
  try {
    return isLocalhostOrigin(new URL(url).origin);
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url);
  }
}

function formatClientGreetingName(clientName: string | null | undefined): string | null {
  if (!clientName?.trim()) return null;
  const first = clientName.trim().split(/\s+/)[0];
  return first || null;
}

const PROPOSAL_CLIENT_INTRO = "Segue a proposta para análise.";
const PROPOSAL_CLIENT_CLOSING =
  "Caso concorde, acesse o link que publico abaixo e confirme o aceite da proposta.";
const PROPOSAL_CLIENT_EMAIL_QR_HINT =
  "Escaneie o QR Code abaixo para abrir a proposta no celular.";
const PROPOSAL_CLIENT_EMAIL_SIGNOFF = ["Fico no aguardo,", "Obrigado pela atenção!"] as const;
const CLIENT_GREETING_BREAK = "\n\n\n";

function buildClientProposalGreeting(clientName: string | null | undefined): string {
  const firstName = formatClientGreetingName(clientName);
  const helloLine = firstName ? `Olá, ${firstName},` : "Olá,";
  return `${helloLine}${CLIENT_GREETING_BREAK}Tudo bem?${CLIENT_GREETING_BREAK}${PROPOSAL_CLIENT_INTRO}`;
}

function appendClientProposalClosingWithLink(lines: string[], proposalUrl: string) {
  lines.push("", PROPOSAL_CLIENT_CLOSING);
  const url = sanitizePublicProposalUrl(proposalUrl.trim());
  if (url) {
    lines.push("", url);
  }
}

function appendProposalEmailSignoff(lines: string[]) {
  lines.push("", ...PROPOSAL_CLIENT_EMAIL_SIGNOFF, "", "GRX Transportes e Logística");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function generateProposalQrDataUrl(
  url: string,
  options?: { compact?: boolean }
): Promise<string | null> {
  const trimmed = sanitizePublicProposalUrl(url.trim());
  if (!trimmed) return null;

  try {
    const { default: QRCode } = await import("qrcode");
    return await QRCode.toDataURL(trimmed, {
      width: options?.compact ? 160 : 220,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

function buildEmailQrHtmlBlock(qrDataUrl: string): string {
  return [
    `<p style="margin-top:16px;text-align:left">`,
    `<img src="${qrDataUrl}" alt="QR Code da proposta GRX" width="220" height="220"`,
    ` style="display:block;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff" />`,
    `</p>`,
  ].join("");
}

function copyRichHtmlFallback(html: string, plainText: string): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);

  const container = document.createElement("div");
  container.innerHTML = html;
  container.setAttribute("contenteditable", "true");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  document.body.appendChild(container);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(container);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  selection?.removeAllRanges();
  document.body.removeChild(container);

  if (!copied) {
    return copyTextToClipboard(plainText);
  }

  return Promise.resolve(true);
}

type EmailClipboardOptions = {
  qrDataUrl?: string | null;
  logoDataUrl?: string | null;
  companyName?: string;
};

async function copyEmailProposalToClipboard(
  plainBody: string,
  proposalUrl: string,
  options?: EmailClipboardOptions
): Promise<boolean> {
  const url = sanitizePublicProposalUrl(proposalUrl.trim());
  const qrDataUrl = options?.qrDataUrl ?? null;
  const logoDataUrl = options?.logoDataUrl ?? null;
  let qrInserted = false;
  const htmlLines = plainBody.split("\n").flatMap((line) => {
    const lineTrim = line.trim();
    if (url && (lineTrim === url || lineTrim === proposalUrl.trim())) {
      const safe = escapeHtml(url);
      const parts = [`<a href="${safe}">${safe}</a>`];
      if (qrDataUrl && !qrInserted) {
        parts.push(buildEmailQrHtmlBlock(qrDataUrl));
        qrInserted = true;
      }
      return parts;
    }
    return [escapeHtml(line)];
  });
  let html = `<div>${htmlLines.join("<br>")}</div>`;
  if (qrDataUrl && !qrInserted) {
    html += buildEmailQrHtmlBlock(qrDataUrl);
  }

  const { buildEmailBrandFooterHtml, getBrandLogoPublicUrl } = await import("@/lib/brand-email");
  const logoSrc = logoDataUrl ?? getBrandLogoPublicUrl(getPublicAppOrigin());
  html += buildEmailBrandFooterHtml(logoSrc, options?.companyName);

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainBody], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      /* fallback abaixo */
    }
  }

  return await copyRichHtmlFallback(html, plainBody);
}

export function buildWhatsAppProposalText(
  order: ServiceOrder,
  context: ServiceOrderProposalContext,
  proposalUrl: string,
  options?: { forClient?: boolean }
): string {
  const amount = resolveProposalAmount(order);
  const forClient = options?.forClient ?? false;
  const lines = [
    `*Proposta OS ${order.code}* — ${context.companyName}`,
    ``,
    `Cliente: ${order.client_name ?? "—"}`,
    `Tipo: ${SERVICE_ORDER_TYPE_LABELS[order.service_type] ?? order.service_type}`,
    `Data: ${formatServiceDate(order.service_date)}`,
    `Placa: ${order.plate}`,
  ];

  if (order.freight_origin_address || order.freight_destination_address) {
    lines.push(
      ``,
      `*Rota*`,
      `A: ${order.freight_origin_address ?? "—"}`,
      `B: ${order.freight_destination_address ?? "—"}`
    );
    if (order.freight_distance_km) {
      lines.push(`Distância: ${order.freight_distance_km} km`);
    }
    if (order.freight_toll_amount) {
      lines.push(`Pedágio: ${formatCurrency(order.freight_toll_amount)}`);
    }
    if (order.freight_antt_minimum) {
      lines.push(`Piso ANTT: ${formatCurrency(order.freight_antt_minimum)}`);
    }
    if (order.freight_per_diem_total) {
      lines.push(
        `Despesas de viagem: ${formatCurrency(order.freight_per_diem_total)}${
          order.freight_travel_days ? ` (${order.freight_travel_days} dia(s))` : ""
        } · ${perDiemChargeLabel(order.freight_per_diem_charge_to)}`
      );
      if (!isPerDiemClientCharge(order.freight_per_diem_charge_to)) {
        lines.push(`(Não repassado ao cliente — custo GRX)`);
      }
      const perDiemDays = normalizePerDiemDetail(order.freight_per_diem_detail);
      for (const day of perDiemDays) {
        lines.push(
          `  Dia ${day.day}: hosp. ${formatCurrency(day.lodging)} · café ${formatCurrency(day.breakfast)} · almoço ${formatCurrency(day.meals)} · jantar ${formatCurrency(day.dinner)} · diária ${formatCurrency(day.daily_allowance)} = ${formatCurrency(perDiemDayTotal(day))}`
        );
      }
    }
  }

  if (amount != null) {
    lines.push(``, `*Valor proposto: ${formatCurrency(amount)}*`);
  }

  if (forClient) {
    lines.unshift(buildClientProposalGreeting(order.client_name), ``);
    appendClientProposalClosingWithLink(lines, proposalUrl);
  } else {
    lines.push(``, `Status: ${order.status}`, ``, `Ver proposta / PDF:`, proposalUrl);
  }

  return lines.join("\n");
}

export function buildProposalEmailBody(
  order: ServiceOrder,
  context: ServiceOrderProposalContext,
  proposalUrl: string
): string {
  const amount = resolveProposalAmount(order);

  const lines = [
    buildClientProposalGreeting(order.client_name),
    "",
    `Proposta OS ${order.code} — ${context.companyName}`,
    `Cliente: ${order.client_name ?? "—"}`,
    `Tipo: ${SERVICE_ORDER_TYPE_LABELS[order.service_type] ?? order.service_type}`,
    `Data: ${formatServiceDate(order.service_date)}`,
    `Placa: ${order.plate}`,
  ];

  if (order.freight_origin_address || order.freight_destination_address) {
    lines.push(
      "",
      "Rota",
      `A: ${order.freight_origin_address ?? "—"}`,
      `B: ${order.freight_destination_address ?? "—"}`
    );
    if (order.freight_distance_km) {
      lines.push(`Distância: ${order.freight_distance_km} km`);
    }
    if (amount != null) {
      lines.push(`Valor proposto: ${formatCurrency(amount)}`);
    }
  } else if (amount != null) {
    lines.push("", `Valor proposto: ${formatCurrency(amount)}`);
  }

  if (proposalUrl) {
    appendClientProposalClosingWithLink(lines, proposalUrl);
    lines.push("", PROPOSAL_CLIENT_EMAIL_QR_HINT);
    appendProposalEmailSignoff(lines);
  }

  return lines.join("\n");
}

export function formatPhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return digits;
}

function isMobileWhatsAppDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function plainTextForWhatsAppUrl(text: string): string {
  return text.replace(/\*/g, "").replace(/—/g, "-");
}

function isWindowsDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows/i.test(navigator.userAgent) && !isMobileWhatsAppDevice();
}

export function isWindowsWhatsAppDesktop(): boolean {
  return isWindowsDesktop();
}

const WHATSAPP_URL_TEXT_BUDGET = 1500;

function truncateTextForWhatsAppUrl(text: string): string {
  if (encodeURIComponent(text).length <= WHATSAPP_URL_TEXT_BUDGET) return text;

  const linkMatch = text.match(/https?:\/\/\S+/);
  if (linkMatch) {
    const short = `Proposta GRX — veja e confirme pelo link:\n${linkMatch[0]}`;
    if (encodeURIComponent(short).length <= WHATSAPP_URL_TEXT_BUDGET) return short;
  }

  let trimmed = text;
  while (trimmed.length > 0 && encodeURIComponent(trimmed).length > WHATSAPP_URL_TEXT_BUDGET) {
    trimmed = trimmed.slice(0, -20);
  }
  return `${trimmed.trim()}…`;
}

export type WhatsAppShareLinks = {
  message: string;
  /** Protocolo nativo — exige WhatsApp como app padrão do link WHATSAPP no Windows. */
  desktopHref: string;
  /** Link Meta — costuma funcionar melhor com WhatsApp da Microsoft Store. */
  storeAppHref: string;
  mobileHref: string;
  /** Melhor opção conforme o sistema. */
  primaryHref: string;
};

export function buildWhatsAppShareLinks(
  text: string,
  phone?: string | null
): WhatsAppShareLinks {
  const normalized = phone ? formatPhoneForWhatsApp(phone) : null;
  const plainMessage = plainTextForWhatsAppUrl(text);
  const urlText = truncateTextForWhatsAppUrl(plainMessage);
  const encodedText = encodeURIComponent(urlText);
  const desktopParams = normalized
    ? `phone=${normalized}&text=${encodedText}`
    : `text=${encodedText}`;

  const mobileBase = normalized ? `https://wa.me/${normalized}` : "https://wa.me/";
  const storeAppHref = normalized
    ? `https://api.whatsapp.com/send?phone=${normalized}&text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;

  const desktopHref = `whatsapp://send/?${desktopParams}`;
  const mobileHref = `${mobileBase}?text=${encodedText}`;

  const primaryHref = isMobileWhatsAppDevice()
    ? mobileHref
    : isWindowsDesktop()
      ? storeAppHref
      : desktopHref;

  return {
    message: text,
    desktopHref,
    storeAppHref,
    mobileHref,
    primaryHref,
  };
}

export function buildWhatsAppSendUrl(text: string, phone?: string | null): string {
  const links = buildWhatsAppShareLinks(text, phone);
  return isMobileWhatsAppDevice() ? links.mobileHref : links.desktopHref;
}

/** Copia em background — não bloqueia a abertura do app. */
export function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => copyTextToClipboardFallback(text)
    );
  }
  return Promise.resolve(copyTextToClipboardFallback(text));
}

function copyTextToClipboardFallback(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export type WhatsAppShareResult = {
  copied: boolean;
  mode: "desktop-app" | "mobile-web" | "clipboard-only";
};

function launchCustomProtocol(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Tentativa programática (menos confiável que <a href> nativo no JSX).
 */
export function openWhatsAppDesktopSync(
  text: string,
  phone?: string | null
): WhatsAppShareResult {
  const links = buildWhatsAppShareLinks(text, phone);

  if (isMobileWhatsAppDevice()) {
    window.open(links.mobileHref, "_blank", "noopener,noreferrer");
    return { copied: false, mode: "mobile-web" };
  }

  launchCustomProtocol(links.desktopHref);
  return { copied: false, mode: "desktop-app" };
}

/**
 * Copia a mensagem e abre o WhatsApp.
 * Prefer openWhatsAppDesktopSync dentro do handler de clique quando o texto já estiver pronto.
 */
export async function shareViaWhatsApp(
  text: string,
  phone?: string | null
): Promise<WhatsAppShareResult> {
  const opened = openWhatsAppDesktopSync(text, phone);
  const copied = await copyTextToClipboard(text);
  return { copied, mode: copied ? opened.mode : "clipboard-only" };
}

/** @deprecated Prefer shareViaWhatsApp — wa.me abre diálogo app vs web no desktop. */
export function openWhatsAppShare(text: string, phone?: string | null) {
  void shareViaWhatsApp(text, phone);
}

function normalizeEmailLineBreaks(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

function buildMailtoSafeBody(fullBody: string, proposalUrl: string): string {
  const normalized = fullBody.replace(/\r\n/g, "\n");
  const linkMatch = normalized.match(/https?:\/\/\S+/);
  const link = sanitizePublicProposalUrl(linkMatch?.[0] ?? proposalUrl);
  const greetingEnd = normalized.indexOf(PROPOSAL_CLIENT_INTRO);
  const greeting =
    greetingEnd >= 0
      ? normalized.slice(0, greetingEnd + PROPOSAL_CLIENT_INTRO.length)
      : normalized.split("\n").slice(0, 8).join("\n");

  const rotaIndex = normalized.indexOf("\nRota\n");
  let summary = "";
  if (rotaIndex >= 0) {
    summary = normalized.slice(rotaIndex + 1).split("\n").slice(0, 5).join("\n").trim();
  }

  const parts = [greeting.trim()];
  if (summary) parts.push("", summary);
  parts.push("", PROPOSAL_CLIENT_CLOSING);
  if (link) parts.push("", link);

  return normalizeEmailLineBreaks(parts.join("\n"));
}

export type EmailShareOptions = {
  qrDataUrl?: string | null;
  logoDataUrl?: string | null;
  companyName?: string;
};

export type EmailShareResult = {
  copied: boolean;
  hasQr: boolean;
  hasLogo: boolean;
};

export async function openEmailShare(
  subject: string,
  body: string,
  proposalUrl = "",
  options?: EmailShareOptions & { to?: string | null }
): Promise<EmailShareResult> {
  const safeUrl = sanitizePublicProposalUrl(proposalUrl);
  const plainBody = body.replace(/\r\n/g, "\n");
  const qrDataUrl = options?.qrDataUrl ?? null;
  const logoDataUrl = options?.logoDataUrl ?? null;
  const copied = await copyEmailProposalToClipboard(plainBody, safeUrl, {
    qrDataUrl,
    logoDataUrl,
    companyName: options?.companyName,
  });
  const hasRichPaste = Boolean(copied && (qrDataUrl || logoDataUrl || safeUrl));
  const mailtoBody = hasRichPaste ? "" : buildMailtoSafeBody(plainBody, safeUrl);
  const to = options?.to?.trim();
  const mailtoPrefix = to ? `mailto:${encodeURIComponent(to)}` : "mailto:";
  const href = `${mailtoPrefix}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailtoBody)}`;

  if (hasRichPaste) {
    window.alert(
      "Proposta copiada (link de produção, QR Code e logo GRX).\n\nNo Gmail ou Outlook, clique no corpo do e-mail e pressione Ctrl+V para colar tudo. Não use o texto curto do mailto — só o Ctrl+V traz QR e logo."
    );
  }

  window.location.href = href;
  return { copied, hasQr: Boolean(qrDataUrl), hasLogo: Boolean(logoDataUrl) };
}

export function triggerPrintPdf() {
  window.print();
}

/** Abre diálogo de impressão para salvar PDF sem dados internos (DRE oculta via CSS). */
export function triggerClientPdfForWhatsApp(orderCode: string) {
  const previousTitle = document.title;
  document.title = `Proposta-OS-${orderCode}-GRX`;
  window.print();
  window.setTimeout(() => {
    document.title = previousTitle;
  }, 500);
}
