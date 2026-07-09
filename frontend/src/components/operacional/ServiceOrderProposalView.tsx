"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { formatServiceCategories } from "@/lib/service-order-categories";
import {
  billablePerDiemTotal,
  isPerDiemClientCharge,
  normalizePerDiemDetail,
  perDiemChargeLabel,
  perDiemDayTotal,
} from "@/lib/freight-per-diem";
import {
  buildProposalEmailBody,
  buildEmailProposalRichHtml,
  buildWhatsAppProposalText,
  buildWhatsAppShareLinks,
  copyRichHtmlToClipboardSync,
  copyTextToClipboardSync,
  formatServiceDate,
  generateProposalQrDataUrl,
  isLocalhostPublicProposalUrl,
  isWindowsWhatsAppDesktop,
  launchProposalEmailShareSync,
  resolveClientProposalShareUrl,
  resolveProposalAcceptanceTestUrl,
  resolveProposalAmount,
  triggerClientPdfForWhatsApp,
  type ServiceOrderProposalContext,
} from "@/lib/service-order-proposal";
import { markProposalSent, resetProposalClientResponse } from "@/lib/service-order-proposal-api";

const ProposalQrCode = dynamic(
  () => import("@/components/operacional/ProposalQrCode").then((mod) => mod.ProposalQrCode),
  {
    loading: () => <p className="text-xs text-slate-500">Gerando QR Code...</p>,
    ssr: false,
  }
);
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import {
  PROPOSAL_RESPONSE_LABELS,
  SERVICE_ORDER_TYPE_LABELS,
  type ProposalResponse,
  type ServiceOrder,
} from "@/types/database";

type Props = {
  order: ServiceOrder;
  context: ServiceOrderProposalContext;
  variant?: "staff" | "public";
  proposalResponse?: ProposalResponse;
  onProposalUpdated?: (patch: Partial<ServiceOrder>) => void;
};

export function ServiceOrderProposalView({
  order,
  context,
  variant = "staff",
  proposalResponse = order.proposal_response ?? "pending",
  onProposalUpdated,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [markingSent, setMarkingSent] = useState(false);
  const [resettingProposal, setResettingProposal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [whatsappHint, setWhatsappHint] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [emailQrDataUrl, setEmailQrDataUrl] = useState<string | null>(null);
  const emailRichCopiedRef = useRef(false);
  const [publicToken, setPublicToken] = useState(order.proposal_token);
  const [sentAt, setSentAt] = useState(order.proposal_sent_at);

  const amount = resolveProposalAmount(order);
  const tolls = Array.isArray(order.freight_toll_detail) ? order.freight_toll_detail : [];
  const perDiemDays = normalizePerDiemDetail(order.freight_per_diem_detail);
  const isPublic = variant === "public";
  const clientShareUrl = resolveClientProposalShareUrl(publicToken);
  const acceptanceTestUrl = resolveProposalAcceptanceTestUrl(publicToken);
  const publicUrl = clientShareUrl;
  const qrUrl = acceptanceTestUrl ?? clientShareUrl;
  const shareUrl = publicUrl ?? "";
  const emailAssetsReady = Boolean(emailQrDataUrl);
  const isDev = process.env.NODE_ENV === "development";
  const hasRoute = Boolean(order.freight_origin_address || order.freight_destination_address);

  useEffect(() => {
    if (!clientShareUrl) {
      setEmailQrDataUrl(null);
      return;
    }

    let cancelled = false;
    void generateProposalQrDataUrl(clientShareUrl).then((qrDataUrl) => {
      if (!cancelled && qrDataUrl) {
        setEmailQrDataUrl(qrDataUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clientShareUrl]);

  const handleMarkSent = async () => {
    setMarkingSent(true);
    setActionError(null);
    const { token, proposalSentAt, error } = await markProposalSent(supabase, order.id);
    setMarkingSent(false);

    if (error) {
      setActionError(error);
      return;
    }

    if (token) setPublicToken(token);
    if (proposalSentAt) setSentAt(proposalSentAt);

    onProposalUpdated?.({
      proposal_token: token ?? publicToken,
      proposal_sent_at: proposalSentAt ?? sentAt,
      status:
        proposalResponse === "accepted"
          ? "Aberto"
          : "Aguardando aprovação cliente",
      proposal_response:
        proposalResponse === "accepted" || proposalResponse === "rejected"
          ? proposalResponse
          : "pending",
    });
  };

  const whatsappShare = useMemo(() => {
    const shareUrl = resolveClientProposalShareUrl(publicToken);
    if (!shareUrl) return null;
    const message = buildWhatsAppProposalText(order, context, shareUrl, { forClient: true });
    return buildWhatsAppShareLinks(message, order.phone);
  }, [publicToken, order, context]);

  const whatsappHref = whatsappShare?.primaryHref ?? null;
  const whatsappAppHref = whatsappShare?.desktopHref ?? null;

  const secondaryActionClass =
    "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50";

  const handleWhatsAppAnchorMouseDown = () => {
    if (!whatsappShare) return;
    copyTextToClipboardSync(whatsappShare.message);
  };

  const handleWhatsAppAnchorClick = () => {
    if (!whatsappShare) return;
    setWhatsappHint(
      isWindowsWhatsAppDesktop()
        ? "Mensagem copiada. WhatsApp abrirá com o texto — use Ctrl+V se o chat vier vazio."
        : "Mensagem copiada. Confira o chat do cliente e pressione Enter."
    );
  };

  const registerThenWhatsApp = () => {
    void (async () => {
      setMarkingSent(true);
      setActionError(null);
      const result = await markProposalSent(supabase, order.id);
      setMarkingSent(false);

      if (result.error) {
        setActionError(result.error);
        return;
      }

      const token = result.token;
      if (token) setPublicToken(token);
      if (result.proposalSentAt) setSentAt(result.proposalSentAt);
      onProposalUpdated?.({
        proposal_token: token,
        proposal_sent_at: result.proposalSentAt,
        status: "Aguardando aprovação cliente",
      });

      setWhatsappHint(
        token
          ? "Envio registrado. Clique em «Enviar no WhatsApp» novamente para abrir o app com o texto pronto."
          : "Envio registrado, mas o link não foi gerado. Recarregue a página e tente de novo."
      );
    })();
  };

  const savePdfForWhatsApp = () => {
    triggerClientPdfForWhatsApp(order.code);
  };

  const handleResetClientResponse = async () => {
    if (
      !window.confirm(
        "Reabrir o link público para o cliente responder Aceitar ou Recusar novamente?"
      )
    ) {
      return;
    }

    setResettingProposal(true);
    setActionError(null);
    const { proposalResponse: next, status, error } = await resetProposalClientResponse(
      supabase,
      order.id
    );
    setResettingProposal(false);

    if (error) {
      setActionError(error);
      return;
    }

    onProposalUpdated?.({
      proposal_response: next ?? "pending",
      status: status ?? "Aguardando aprovação cliente",
    });
  };

  const handleEmailMouseDown = () => {
    const url = resolveClientProposalShareUrl(publicToken);
    if (!url || !emailQrDataUrl) {
      emailRichCopiedRef.current = false;
      return;
    }

    const body = buildProposalEmailBody(order, context, url);
    const html = buildEmailProposalRichHtml(body, url, {
      qrDataUrl: emailQrDataUrl,
      logoDataUrl: null,
      companyName: context.companyName,
    });
    emailRichCopiedRef.current = copyRichHtmlToClipboardSync(html, body);
  };

  const shareEmail = () => {
    const url = resolveClientProposalShareUrl(publicToken);
    if (!url) {
      window.alert(
        "Registre o envio da proposta primeiro.\n\nO link e o e-mail só funcionam após gerar o link público de produção."
      );
      return;
    }

    const body = buildProposalEmailBody(order, context, url);

    if (!emailAssetsReady || !emailQrDataUrl) {
      launchProposalEmailShareSync(`Proposta OS ${order.code} — ${context.companyName}`, body, url);
      setEmailHint("E-mail aberto com texto. Recarregue (F5) e tente de novo para incluir o QR Code.");
      return;
    }

    const preCopied = emailRichCopiedRef.current;
    const { richCopied, hasQr } = launchProposalEmailShareSync(
      `Proposta OS ${order.code} — ${context.companyName}`,
      body,
      url,
      {
        qrDataUrl: emailQrDataUrl,
        companyName: context.companyName,
        skipCopy: preCopied,
        richCopied: preCopied,
      }
    );

    emailRichCopiedRef.current = false;

    setEmailHint(
      richCopied && hasQr
        ? "E-mail aberto com texto. Clique no corpo e pressione Ctrl+V para incluir o QR Code. (Logo na assinatura do Outlook.)"
        : "E-mail aberto com texto. Recarregue (F5) se o QR Code não colar com Ctrl+V."
    );
  };

  const copyLink = async () => {
    if (!publicUrl) {
      window.alert("Registre o envio da proposta primeiro para gerar o link público.");
      return;
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      window.alert("Link público copiado. Envie ao cliente por WhatsApp ou e-mail.");
    } catch {
      window.prompt("Copie o link da proposta:", publicUrl);
    }
  };

  return (
    <>
      <style>{`
        @media print {
          aside, .app-shell-header, .proposal-toolbar { display: none !important; }
          main { padding: 0 !important; }
          .proposal-document { box-shadow: none !important; border: none !important; }
          .proposal-logo,
          .proposal-logo .brand-logo-brand,
          .proposal-logo .brand-logo-plaque,
          .proposal-logo .brand-logo-3d-stage,
          .proposal-logo .brand-logo-3d-stack {
            display: block !important;
            visibility: visible !important;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .proposal-logo .brand-logo-3d-stack {
            display: grid !important;
            place-items: center;
          }
          .proposal-logo .brand-logo-3d-stack img {
            grid-area: 1 / 1 !important;
            display: block !important;
            visibility: visible !important;
            max-width: 240px;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .proposal-internal { display: none !important; }
        }
        ${isPublic ? `.proposal-internal { display: none !important; }` : ""}
      `}</style>

      {!isPublic && (
        <>
          <div className="proposal-toolbar mb-4 flex flex-wrap items-center gap-2">
            <Badge variant={proposalResponse === "accepted" ? "success" : "warning"}>
              {PROPOSAL_RESPONSE_LABELS[proposalResponse]}
            </Badge>
            {sentAt && (
              <span className="text-sm text-slate-500">
                Enviada em {new Date(sentAt).toLocaleString("pt-BR")}
              </span>
            )}
          </div>

          <div className="proposal-toolbar mb-6 flex flex-wrap gap-2 print:hidden">
            <Button type="button" onClick={savePdfForWhatsApp}>
              Salvar PDF para cliente
            </Button>
            {whatsappHref ? (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(secondaryActionClass, markingSent && "pointer-events-none opacity-50")}
                onMouseDown={handleWhatsAppAnchorMouseDown}
                onClick={handleWhatsAppAnchorClick}
              >
                Enviar no WhatsApp
              </a>
            ) : (
              <Button type="button" variant="secondary" disabled={markingSent} onClick={registerThenWhatsApp}>
                Enviar no WhatsApp
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={!emailAssetsReady}
              onMouseDown={handleEmailMouseDown}
              onClick={shareEmail}
            >
              {emailAssetsReady ? "Enviar por e-mail" : "Preparando QR Code…"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void copyLink()}>
              Copiar link público
            </Button>
            {!sentAt && (
              <Button type="button" variant="secondary" disabled={markingSent} onClick={() => void handleMarkSent()}>
                Registrar envio ao cliente
              </Button>
            )}
            {sentAt && proposalResponse !== "pending" && (
              <Button
                type="button"
                variant="secondary"
                disabled={resettingProposal}
                onClick={() => void handleResetClientResponse()}
              >
                Reabrir link para o cliente
              </Button>
            )}
          </div>

          <p className="proposal-toolbar mb-4 text-sm text-slate-500 print:hidden">
            Fluxo sugerido: registre o envio (link com aceite) → «Enviar no WhatsApp» (abre o app e copia a
            mensagem com o link) → opcional: anexe o PDF salvo com o clipe no WhatsApp.
          </p>

          {emailHint && (
            <p className="proposal-toolbar mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 print:hidden">
              {emailHint}
            </p>
          )}

          {whatsappHint && (
            <p className="proposal-toolbar mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 print:hidden">
              {whatsappHint}
            </p>
          )}

          {whatsappShare && (
            <p className="proposal-toolbar mb-4 text-xs text-slate-500 print:hidden">
              WhatsApp: mensagem copiada ao clicar. A prévia do link (logo 3D) atualiza em conversas novas — o
              WhatsApp guarda cache da imagem antiga por alguns dias.
              {whatsappAppHref && whatsappHref !== whatsappAppHref ? (
                <>
                  {" "}
                  Se o app não abrir,{" "}
                  <a href={whatsappAppHref} className="font-medium text-brand-700 underline">
                    abrir no WhatsApp desktop
                  </a>
                  .
                </>
              ) : null}
            </p>
          )}

          {isDev && acceptanceTestUrl && acceptanceTestUrl !== publicUrl && (
            <div className="proposal-toolbar mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 print:hidden">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                Link de teste — Aceitar / Recusar (desenvolvimento)
              </p>
              <p className="mt-1 break-all text-sm font-medium text-blue-950">{acceptanceTestUrl}</p>
              <p className="mt-2 text-xs text-blue-800">
                Use este link e o QR abaixo para testar agora. No celular, PC e celular precisam estar na
                mesma Wi-Fi. Antes do teste, clique em «Reabrir link para o cliente» se a proposta já
                estiver aceita.
              </p>
            </div>
          )}

          {publicUrl && (
            <div className="proposal-toolbar mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 print:hidden">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Link do cliente (produção)
              </p>
              <p className="mt-1 break-all text-sm font-medium text-emerald-950">{publicUrl}</p>
              <p className="mt-2 text-xs text-emerald-800">
                Envie ao cliente por e-mail ou WhatsApp após o deploy na Vercel. Para testar aceite/recusa
                agora, use o link azul acima.
              </p>
            </div>
          )}

          {publicUrl && isLocalhostPublicProposalUrl(publicUrl) && (
            <p className="proposal-toolbar mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
              O link abaixo usa <strong>localhost</strong> e não abre no celular. Defina{" "}
              <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_APP_URL</code> no{" "}
              <code className="rounded bg-amber-100 px-1">.env.local</code> e reinicie o servidor.
            </p>
          )}


          {actionError && (
            <p className="proposal-toolbar mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 print:hidden">
              {actionError}
            </p>
          )}
        </>
      )}

      <article className="proposal-document mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <header className="border-b-2 border-brand-600 pb-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="proposal-logo shrink-0 max-w-[240px]">
              <div className="print:hidden">
                <BrandLogo
                  variant="plaque3d"
                  plaqueSurface="page"
                  size="proposal"
                  performanceLite
                  unoptimized
                />
              </div>
              <div className="hidden print:block">
                <BrandLogo variant="plaque3d" plaqueSurface="page" size="proposal" unoptimized />
              </div>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                Proposta de ordem de serviço
              </p>
              <h1 className="mt-2 text-xl font-bold text-slate-900">{context.companyName}</h1>
              <p className="mt-3 text-lg font-semibold text-slate-800">OS {order.code}</p>
              <p className="text-sm text-slate-600">
                Emitida em {formatServiceDate(order.service_date)}
                {!isPublic && (
                  <span className="proposal-internal"> · Status: {order.status}</span>
                )}
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 border-b border-slate-100 py-6 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-semibold uppercase text-slate-500">Cliente</h2>
            <p className="mt-1 font-medium text-slate-900">{order.client_name ?? "—"}</p>
            <p className="text-sm text-slate-600">{order.phone ?? ""}</p>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase text-slate-500">Operação</h2>
            <p className="mt-1 font-medium text-slate-900">
              {SERVICE_ORDER_TYPE_LABELS[order.service_type] ?? order.service_type}
            </p>
            <p className="text-sm text-slate-600">
              {order.service_categories?.length
                ? formatServiceCategories(order.service_categories)
                : order.service_name}
            </p>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase text-slate-500">Veículo</h2>
            <p className="mt-1 font-medium text-slate-900">Placa {order.plate}</p>
            {context.driverName && (
              <p className="text-sm text-slate-600">Motorista: {context.driverName}</p>
            )}
          </div>
          {context.dreAccountName && (
            <div className="proposal-internal">
              <h2 className="text-xs font-semibold uppercase text-slate-500">Conta DRE</h2>
              <p className="mt-1 text-slate-800">{context.dreAccountName}</p>
            </div>
          )}
        </section>

        {hasRoute && (
          <section className="border-b border-slate-100 py-6">
            <h2 className="text-sm font-semibold text-slate-900">Rota e custos</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Origem (A)</dt>
                <dd className="font-medium text-slate-800">{order.freight_origin_address ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Destino (B)</dt>
                <dd className="font-medium text-slate-800">{order.freight_destination_address ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Distância</dt>
                <dd>{order.freight_distance_km ? `${order.freight_distance_km} km` : "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Pedágio total</dt>
                <dd>
                  {order.freight_toll_amount != null
                    ? formatCurrency(order.freight_toll_amount)
                    : "—"}
                  {order.freight_toll_count
                    ? ` (${order.freight_toll_count} praça${order.freight_toll_count === 1 ? "" : "s"})`
                    : ""}
                </dd>
              </div>
              {order.freight_antt_minimum != null && (
                <div>
                  <dt className="text-slate-500">Piso mínimo ANTT</dt>
                  <dd>{formatCurrency(order.freight_antt_minimum)}</dd>
                </div>
              )}
              {order.freight_suggested_total != null && (
                <div>
                  <dt className="text-slate-500">Sugerido (piso + pedágio + despesas)</dt>
                  <dd>{formatCurrency(order.freight_suggested_total)}</dd>
                </div>
              )}
              {order.freight_per_diem_total != null && order.freight_per_diem_total > 0 && (
                <div>
                  <dt className="text-slate-500">Despesas de viagem</dt>
                  <dd>
                    {formatCurrency(order.freight_per_diem_total)}
                    {order.freight_travel_days
                      ? ` · ${order.freight_travel_days} dia(s)`
                      : ""}
                    {" · "}
                    {perDiemChargeLabel(order.freight_per_diem_charge_to)}
                  </dd>
                </div>
              )}
              {isPerDiemClientCharge(order.freight_per_diem_charge_to) &&
                order.freight_per_diem_total != null &&
                order.freight_per_diem_total > 0 && (
                <div>
                  <dt className="text-slate-500">Repasse despesas ao cliente</dt>
                  <dd>{formatCurrency(billablePerDiemTotal(order.freight_per_diem_total, order.freight_per_diem_charge_to))}</dd>
                </div>
              )}
            </dl>

            {perDiemDays.length > 0 && (
              <table className="mt-4 w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2 pr-2">Dia</th>
                    <th className="py-2 pr-2">Hospedagem</th>
                    <th className="py-2 pr-2">Café</th>
                    <th className="py-2 pr-2">Almoço</th>
                    <th className="py-2 pr-2">Jantar</th>
                    <th className="py-2 pr-2">Diária</th>
                    <th className="py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {perDiemDays.map((day) => (
                    <tr key={day.day} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2">{day.day}</td>
                      <td className="py-1.5 pr-2">{formatCurrency(day.lodging)}</td>
                      <td className="py-1.5 pr-2">{formatCurrency(day.breakfast)}</td>
                      <td className="py-1.5 pr-2">{formatCurrency(day.meals)}</td>
                      <td className="py-1.5 pr-2">{formatCurrency(day.dinner)}</td>
                      <td className="py-1.5 pr-2">{formatCurrency(day.daily_allowance)}</td>
                      <td className="py-1.5 text-right">{formatCurrency(perDiemDayTotal(day))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tolls.length > 0 && (
              <table className="mt-4 w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Praça</th>
                    <th className="py-2 pr-2">Local</th>
                    <th className="py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {tolls.map((plaza) => (
                    <tr key={`${plaza.order}-${plaza.name}`} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2">{plaza.order}</td>
                      <td className="py-1.5 pr-2">{plaza.name}</td>
                      <td className="py-1.5 pr-2">
                        {[plaza.city, plaza.state].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="py-1.5 text-right">{formatCurrency(plaza.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <section className="border-b border-slate-100 py-6">
          <h2 className="text-sm font-semibold text-slate-900">Valor para aprovação</h2>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            {amount != null ? formatCurrency(amount) : "A combinar"}
          </p>
          {order.notes && (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium">Observações:</span> {order.notes}
            </p>
          )}
        </section>

        {qrUrl && !isPublic && (
          <section className="border-b border-slate-100 py-6">
            <div className="proposal-body-qr flex flex-col items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-6">
              <p className="text-sm font-semibold text-slate-900">
                Escaneie para abrir a proposta e confirmar aceite ou recusa
              </p>
              <ProposalQrCode url={qrUrl} compact />
              <p className="break-all text-left text-xs text-slate-500">{qrUrl}</p>
            </div>
          </section>
        )}

        <footer className="pt-8">
          <p className="text-sm text-slate-600">
            Esta proposta destina-se à aprovação do cliente. Após o aceite, a ordem de serviço poderá
            ser concluída no sistema.
          </p>
          <div className="mt-10 grid gap-10 sm:grid-cols-2">
            <div>
              <div className="border-t border-slate-400 pt-2 text-sm text-slate-700">
                Aprovação do cliente
              </div>
            </div>
            <div>
              <div className="border-t border-slate-400 pt-2 text-sm text-slate-700">
                {context.companyName}
              </div>
            </div>
          </div>
          <p className="mt-8 text-xs text-slate-400 print:block hidden sm:block">
            GRX Transportes e Logística · Documento gerado pelo GRX Management ·{" "}
            {new Date().toLocaleString("pt-BR")}
          </p>
        </footer>
      </article>
    </>
  );
}
