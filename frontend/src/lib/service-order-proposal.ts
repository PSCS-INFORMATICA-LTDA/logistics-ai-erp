import {
  buildEmailBrandFooterHtml,
  resolveEmailBrandLogoSrc,
} from "@/lib/brand-email";
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
  const proposalToken = trimmed.match(/\/proposta\/([a-f0-9]{32,})/i);
  if (proposalToken?.[1]) {
    return buildPublicProposalUrl(proposalToken[1]);
  }
  const assignmentToken = trimmed.match(/\/designacao\/([a-f0-9]{32,})/i);
  if (assignmentToken?.[1]) {
    return `${getPublicAppOrigin()}/designacao/${assignmentToken[1]}`;
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
const DRIVER_ASSIGNMENT_INTRO =
  "Segue a designação da ordem de serviço para sua confirmação.";
const SHARE_INTRO_MARKERS = [PROPOSAL_CLIENT_INTRO, DRIVER_ASSIGNMENT_INTRO] as const;
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

const MAX_CLIPBOARD_HTML_CHARS = 180_000;

function cfHtmlByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Formato CF_HTML exigido pelo Gmail/Outlook no Windows para colar imagens. */
export function buildCfHtmlDocument(fragmentHtml: string): string {
  const fragment = `<!--StartFragment-->${fragmentHtml}<!--EndFragment-->`;
  const htmlDoc =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word">` +
    `<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>` +
    `<body>${fragment}</body></html>`;

  const headerFor = (startHtml: number, endHtml: number, startFragment: number, endFragment: number) =>
    `Version:1.0\r\n` +
    `StartHTML:${String(startHtml).padStart(10, "0")}\r\n` +
    `EndHTML:${String(endHtml).padStart(10, "0")}\r\n` +
    `StartFragment:${String(startFragment).padStart(10, "0")}\r\n` +
    `EndFragment:${String(endFragment).padStart(10, "0")}\r\n`;

  let startHtml = 0;
  let endHtml = 0;
  let startFragment = 0;
  let endFragment = 0;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const header = headerFor(startHtml, endHtml, startFragment, endFragment);
    startHtml = cfHtmlByteLength(header);
    const docStart = startHtml;
    endHtml = docStart + cfHtmlByteLength(htmlDoc);

    const startMarker = "<!--StartFragment-->";
    const endMarker = "<!--EndFragment-->";
    startFragment =
      docStart + cfHtmlByteLength(htmlDoc.slice(0, htmlDoc.indexOf(startMarker) + startMarker.length));
    endFragment = docStart + cfHtmlByteLength(htmlDoc.slice(0, htmlDoc.indexOf(endMarker)));
  }

  return headerFor(startHtml, endHtml, startFragment, endFragment) + htmlDoc;
}

/** @deprecated Prefer buildCfHtmlDocument for clipboard writes. */
function wrapHtmlForClipboard(innerHtml: string): string {
  if (innerHtml.includes("StartFragment")) return innerHtml;
  return buildCfHtmlDocument(innerHtml);
}

/**
 * Synchronous rich HTML copy — must run inside mousedown/click user gesture.
 * Never falls back to plain text (that would erase QR/logo from the clipboard).
 */
export function copyRichHtmlToClipboardSync(html: string): boolean {
  if (typeof document === "undefined") return false;

  const container = document.createElement("div");
  container.innerHTML = html;
  container.setAttribute("contenteditable", "true");
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.width = "2px";
  container.style.height = "2px";
  container.style.overflow = "hidden";
  container.style.opacity = "0.01";
  container.style.pointerEvents = "none";
  document.body.appendChild(container);

  container.focus();
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
  return copied;
}

async function copyRichHtmlViaClipboardApi(html: string, plainText: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }
  if (html.length > MAX_CLIPBOARD_HTML_CHARS) return false;

  const cfHtml = buildCfHtmlDocument(html);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([cfHtml], { type: "text/html" }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function copyPreparedEmailHtmlToClipboardAsync(
  html: string,
  plainBody: string
): Promise<boolean> {
  if (copyRichHtmlToClipboardSync(html)) return true;
  return copyRichHtmlViaClipboardApi(html, plainBody);
}

export function copyPreparedEmailHtmlToClipboard(html: string, plainBody: string): boolean {
  return copyRichHtmlToClipboardSync(html);
}

type EmailClipboardOptions = {
  qrDataUrl?: string | null;
  logoDataUrl?: string | null;
  companyName?: string;
};

function buildEmailProposalHtml(
  plainBody: string,
  proposalUrl: string,
  options?: EmailClipboardOptions
): string {
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

  return html;
}

function appendEmailBrandFooter(
  html: string,
  logoDataUrl: string | null | undefined,
  companyName?: string
): string {
  const logoSrc = resolveEmailBrandLogoSrc(logoDataUrl ?? null, getPublicAppOrigin());
  return (
    html +
    buildEmailBrandFooterHtml(logoSrc, companyName, {
      framed: !logoSrc.startsWith("data:image"),
    })
  );
}

export function buildEmailProposalRichHtml(
  plainBody: string,
  proposalUrl: string,
  options?: EmailClipboardOptions
): string {
  let html = buildEmailProposalHtml(plainBody, proposalUrl, options);
  html = appendEmailBrandFooter(html, options?.logoDataUrl, options?.companyName);

  if (html.length > MAX_CLIPBOARD_HTML_CHARS && options?.qrDataUrl) {
    html = buildEmailProposalHtml(plainBody, proposalUrl, {
      ...options,
      qrDataUrl: null,
    });
    html = appendEmailBrandFooter(html, options?.logoDataUrl, options?.companyName);
  }

  return html;
}

async function copyEmailProposalToClipboard(
  plainBody: string,
  proposalUrl: string,
  options?: EmailClipboardOptions
): Promise<boolean> {
  const html = buildEmailProposalRichHtml(plainBody, proposalUrl, options);
  if (copyRichHtmlToClipboardSync(html)) return true;
  if (await copyRichHtmlViaClipboardApi(html, plainBody)) return true;
  return false;
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

/** Telefone fictício do seed demo (OS001) — não existe no WhatsApp. */
export function isDemoSeedWhatsAppPhone(phone: string | null | undefined): boolean {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits === "5511987654321" || digits === "11987654321";
}

export type WhatsAppShareLinkOptions = {
  /** Abre o app sem fixar chat (útil quando o telefone da OS é placeholder). */
  omitPhone?: boolean;
};

function isMobileWhatsAppDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function plainTextForWhatsAppUrl(text: string): string {
  return text.replace(/\*/g, "").replace(/—/g, "-");
}

/** Quebra detecção de URL pelo WhatsApp para não montar card de preview (OG do site). */
export function suppressWhatsAppLinkPreview(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(/^(https?:\/\/)/i, "$1\u200B");
}

function obfuscateUrlsInWhatsAppText(text: string): string {
  return text.replace(/https?:\/\/[^\s\n]+/g, (match) => suppressWhatsAppLinkPreview(match));
}

/** Mensagem final para clipboard e parâmetro text= (URLs sem preview). */
export function formatWhatsAppShareMessage(text: string): string {
  return obfuscateUrlsInWhatsAppText(text);
}

function isWindowsDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows/i.test(navigator.userAgent) && !isMobileWhatsAppDevice();
}

export function isWindowsWhatsAppDesktop(): boolean {
  return isWindowsDesktop();
}

const WHATSAPP_URL_TEXT_BUDGET = 2800;

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
  phone?: string | null,
  options?: WhatsAppShareLinkOptions
): WhatsAppShareLinks {
  const skipPhone = options?.omitPhone || isDemoSeedWhatsAppPhone(phone);
  const normalized = skipPhone ? null : phone ? formatPhoneForWhatsApp(phone) : null;
  const messageForShare = formatWhatsAppShareMessage(text);
  const plainMessage = plainTextForWhatsAppUrl(messageForShare);
  const urlText = truncateTextForWhatsAppUrl(plainMessage);
  const encodedText = encodeURIComponent(urlText);
  const desktopParams = normalized
    ? `phone=${normalized}&text=${encodedText}`
    : `text=${encodedText}`;

  const mobileBase = normalized ? `https://wa.me/${normalized}` : "https://wa.me/";
  const storeAppHref = normalized
    ? `https://api.whatsapp.com/send?phone=${normalized}&text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;

  // Formato oficial: whatsapp://send?phone=… (sem barra extra após send).
  const desktopHref = `whatsapp://send?${desktopParams}`;
  const mobileHref = `${mobileBase}?text=${encodedText}`;

  // Desktop: api.whatsapp.com abre WhatsApp Web/Store com texto — fluxo que funcionava nos testes.
  const primaryHref = isMobileWhatsAppDevice() ? mobileHref : storeAppHref;

  return {
    message: messageForShare,
    desktopHref,
    storeAppHref,
    mobileHref,
    primaryHref,
  };
}

export function isWhatsAppNativeHref(href: string): boolean {
  return href.startsWith("whatsapp://");
}

export function openWhatsAppShareHref(href: string, targetWindow?: Window | null): void {
  if (isWhatsAppNativeHref(href)) {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.href = href;
      return;
    }
    // Deixa o clique nativo no <a href> abrir o protocolo quando possível.
    launchCustomProtocol(href);
    return;
  }
  openExternalUrl(href, targetWindow);
}

export function openExternalUrl(url: string, targetWindow?: Window | null): void {
  if (targetWindow && !targetWindow.closed) {
    targetWindow.location.href = url;
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function openMailtoLink(href: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function buildWhatsAppSendUrl(text: string, phone?: string | null): string {
  const links = buildWhatsAppShareLinks(text, phone);
  return isMobileWhatsAppDevice() ? links.mobileHref : links.desktopHref;
}

/** Copia texto no gesto do utilizador (mousedown/click) — não usar após await. */
export function copyTextToClipboardSync(text: string): boolean {
  if (typeof document === "undefined") return false;
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

export async function shareViaWhatsAppPrepared(
  urlText: string,
  clipboardText: string,
  phone?: string | null,
  options?: { preOpenedWindow?: Window | null; copiedHint?: string; skipCopy?: boolean }
): Promise<WhatsAppShareResult> {
  const links = buildWhatsAppShareLinks(urlText, phone);
  const copied = options?.skipCopy
    ? true
    : copyTextToClipboardSync(clipboardText) || (await copyTextToClipboard(clipboardText));
  openWhatsAppShareHref(links.primaryHref, options?.preOpenedWindow ?? null);

  if (copied) {
    if (options?.copiedHint) {
      window.alert(options.copiedHint);
    }
    return { copied: true, mode: "desktop-app" };
  }

  window.alert(
    "Não foi possível copiar automaticamente.\n\nCopie a mensagem exibida em seguida e cole no WhatsApp."
  );
  window.prompt("Copie a mensagem:", clipboardText);
  return { copied: false, mode: "clipboard-only" };
}

/**
 * Copia a mensagem e abre o WhatsApp.
 * Prefer shareViaWhatsAppPrepared quando o texto já estiver pronto após RPC assíncrono.
 */
export async function shareViaWhatsApp(
  text: string,
  phone?: string | null
): Promise<WhatsAppShareResult> {
  return shareViaWhatsAppPrepared(text, text, phone);
}

/** @deprecated Prefer shareViaWhatsApp — wa.me abre diálogo app vs web no desktop. */
export function openWhatsAppShare(text: string, phone?: string | null) {
  void shareViaWhatsApp(text, phone);
}

function normalizeEmailLineBreaks(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

function buildMailtoSafeBody(fullBody: string, shareUrl: string): string {
  const normalized = fullBody.replace(/\r\n/g, "\n");
  const linkMatch = normalized.match(/https?:\/\/\S+/);
  const link = sanitizePublicProposalUrl(linkMatch?.[0] ?? shareUrl);

  let greetingEnd = -1;
  for (const marker of SHARE_INTRO_MARKERS) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      greetingEnd = idx + marker.length;
      break;
    }
  }

  const greeting =
    greetingEnd >= 0
      ? normalized.slice(0, greetingEnd)
      : normalized.split("\n").slice(0, 8).join("\n");

  const rotaIndex = normalized.indexOf("\nRota\n");
  let summary = "";
  if (rotaIndex >= 0) {
    summary = normalized
      .slice(rotaIndex + 1)
      .split("\n")
      .slice(0, 6)
      .join("\n")
      .trim();
  }

  const closingMatch = normalized.match(
    /(?:Caso concorde, acesse o link|Por favor, acesse o link)[^\n]*/i
  );
  const closing =
    closingMatch?.[0] ??
    "Por favor, acesse o link abaixo para confirmar.";

  const parts = [greeting.trim()];
  if (summary) parts.push("", summary);
  parts.push("", closing);
  if (link) parts.push("", link);

  return normalizeEmailLineBreaks(parts.join("\n"));
}

function compactShareBody(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function buildMailtoFallbackBody(fullBody: string, shareUrl: string): string {
  const normalized = compactShareBody(fullBody.replace(/\r\n/g, "\n"));
  if (normalized.length <= 1800) {
    return normalizeEmailLineBreaks(normalized);
  }
  return buildMailtoSafeBody(normalized, shareUrl);
}

function buildMailtoBodyForClient(fullBody: string, shareUrl: string): string {
  const fallback = buildMailtoFallbackBody(fullBody, shareUrl);
  if (encodeURIComponent(fallback).length <= 1800) {
    return fallback;
  }
  return buildMailtoSafeBody(fullBody, shareUrl);
}

const MAX_MAILTO_HREF_LENGTH = 2040;

function buildMailtoHref(
  mailtoPrefix: string,
  subject: string,
  plainBody: string,
  shareUrl: string
): string {
  const body = buildMailtoBodyForClient(plainBody, shareUrl);
  let href = `${mailtoPrefix}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  if (href.length <= MAX_MAILTO_HREF_LENGTH) return href;

  const safeBody = buildMailtoSafeBody(plainBody, shareUrl);
  return `${mailtoPrefix}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(safeBody)}`;
}

export type EmailShareOptions = {
  qrDataUrl?: string | null;
  logoDataUrl?: string | null;
  companyName?: string;
  /** Texto do alerta quando a cópia rica funcionar. */
  copiedAlertMessage?: string;
};

export type EmailShareResult = {
  copied: boolean;
  richCopied: boolean;
  hasQr: boolean;
  hasLogo: boolean;
  plainBody: string;
};

export type EmailShareBundle = {
  subject: string;
  plainBody: string;
  shareUrl: string;
  htmlForClipboard: string;
  mailtoHref: string;
  hasQr: boolean;
  hasLogo: boolean;
};

export async function prepareEmailShareBundle(
  subject: string,
  body: string,
  proposalUrl = "",
  options?: EmailShareOptions & { to?: string | null }
): Promise<EmailShareBundle> {
  const safeUrl = sanitizePublicProposalUrl(proposalUrl);
  const plainBody = body.replace(/\r\n/g, "\n");
  const to = options?.to?.trim();
  const mailtoPrefix = to ? `mailto:${to}` : "mailto:";
  const qrDataUrl = options?.qrDataUrl ?? null;
  const logoDataUrl = options?.logoDataUrl ?? null;

  const htmlForClipboard = buildEmailProposalRichHtml(plainBody, safeUrl, {
    qrDataUrl,
    logoDataUrl,
    companyName: options?.companyName,
  });
  const mailtoHref = buildMailtoHref(mailtoPrefix, subject, plainBody, safeUrl);

  return {
    subject,
    plainBody,
    shareUrl: safeUrl,
    htmlForClipboard,
    mailtoHref,
    hasQr: Boolean(qrDataUrl),
    hasLogo: Boolean(logoDataUrl),
  };
}

export type EmailShareLaunchOptions = {
  copiedAlertMessage?: string;
  /** When true, skip clipboard write (already done on mousedown). */
  skipCopy?: boolean;
  /** When skipCopy is true, whether the prior mousedown copy succeeded. */
  richCopied?: boolean;
};

export function launchPreparedEmailShare(
  bundle: EmailShareBundle,
  options?: EmailShareLaunchOptions
): EmailShareResult {
  const richCopied = options?.skipCopy
    ? Boolean(options.richCopied)
    : copyPreparedEmailHtmlToClipboard(bundle.htmlForClipboard, bundle.plainBody);
  const plainCopied = richCopied ? true : copyTextToClipboardSync(bundle.plainBody);
  const copied = richCopied || plainCopied;

  if (richCopied) {
    window.alert(
      options?.copiedAlertMessage ??
        "Proposta copiada (texto, link, QR Code e logo GRX).\n\n1. O e-mail abrirá com assunto e texto.\n2. Clique no corpo do e-mail e pressione Ctrl+V para colar QR Code e logo."
    );
  } else if (plainCopied) {
    window.alert(
      "Texto copiado.\n\nO e-mail abrirá com assunto e texto. Pressione Ctrl+V no corpo se quiser tentar colar novamente."
    );
  } else {
    window.alert(
      "Não foi possível copiar automaticamente.\n\nO e-mail abrirá com assunto e texto. Copie manualmente se necessário."
    );
    window.prompt("Copie a mensagem:", bundle.plainBody);
  }

  openMailtoLink(bundle.mailtoHref);

  return {
    copied,
    richCopied,
    hasQr: bundle.hasQr,
    hasLogo: bundle.hasLogo,
    plainBody: bundle.plainBody,
  };
}

export async function openEmailShare(
  subject: string,
  body: string,
  proposalUrl = "",
  options?: EmailShareOptions & { to?: string | null }
): Promise<EmailShareResult> {
  const safeUrl = sanitizePublicProposalUrl(proposalUrl);
  const plainBody = body.replace(/\r\n/g, "\n");
  const to = options?.to?.trim();
  const mailtoPrefix = to ? `mailto:${to}` : "mailto:";
  const qrDataUrl = options?.qrDataUrl ?? null;
  const logoDataUrl = options?.logoDataUrl ?? null;

  const html = buildEmailProposalRichHtml(plainBody, safeUrl, {
    qrDataUrl,
    logoDataUrl,
    companyName: options?.companyName,
  });

  let richCopied = copyRichHtmlToClipboardSync(html);
  if (!richCopied) {
    richCopied = await copyRichHtmlViaClipboardApi(html, plainBody);
  }
  if (!richCopied) {
    richCopied = await copyEmailProposalToClipboard(plainBody, safeUrl, {
      qrDataUrl,
      logoDataUrl,
      companyName: options?.companyName,
    });
  }

  const plainCopied = richCopied ? true : await copyTextToClipboard(plainBody);
  const copied = richCopied || plainCopied;
  const href = buildMailtoHref(mailtoPrefix, subject, plainBody, safeUrl);

  if (richCopied) {
    window.alert(
      options?.copiedAlertMessage ??
        "Proposta copiada (texto, link, QR Code e logo GRX).\n\n1. O e-mail abrirá com assunto e texto.\n2. Clique no corpo do e-mail e pressione Ctrl+V para colar QR Code e logo."
    );
  } else if (plainCopied) {
    window.alert(
      "Texto copiado.\n\nO e-mail abrirá com assunto e texto. Pressione Ctrl+V no corpo se quiser tentar colar novamente."
    );
  } else {
    window.alert(
      "Não foi possível copiar automaticamente.\n\nO e-mail abrirá com assunto e texto. Copie manualmente se necessário."
    );
    window.prompt("Copie a mensagem:", plainBody);
  }

  openMailtoLink(href);

  return {
    copied,
    richCopied,
    hasQr: Boolean(qrDataUrl),
    hasLogo: Boolean(logoDataUrl),
    plainBody,
  };
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
