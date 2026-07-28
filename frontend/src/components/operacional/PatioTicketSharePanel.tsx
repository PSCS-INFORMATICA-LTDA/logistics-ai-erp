"use client";

import { useEffect, useMemo, useState } from "react";
import { ProposalQrCode } from "@/components/operacional/ProposalQrCode";
import { WhatsAppButton } from "@/components/operacional/WhatsAppButton";
import { WhatsAppIcon } from "@/components/icons/ShareIcons";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { glassField } from "@/lib/liquid-glass-styles";
import {
  buildPatioTicketWhatsAppMessage,
  ensurePatioTicketToken,
  patioTicketPublicUrl,
  type PatioTicketSource,
} from "@/lib/patio-ticket-api";
import { createClient } from "@/lib/supabase/client";

type Props = {
  source: PatioTicketSource;
  entryId: string;
  kind: "estacionamento" | "lava-rapido";
  companyName: string;
  code: string;
  plate: string;
  phone?: string | null;
  totalAmount?: number | null;
};

export function PatioTicketSharePanel({
  source,
  entryId,
  kind,
  companyName,
  code,
  plate,
  phone,
  totalAmount,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phoneDraft, setPhoneDraft] = useState(phone?.trim() || "");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const result = await ensurePatioTicketToken(supabase, source, entryId);
      if (cancelled) return;
      if (result.error || !result.token) {
        setError(result.error ?? "Falha ao gerar link.");
        setToken(null);
      } else {
        setToken(result.token);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, source, supabase]);

  useEffect(() => {
    setPhoneDraft(phone?.trim() || "");
  }, [phone]);

  const publicUrl = token ? patioTicketPublicUrl(token) : "";
  const message = publicUrl
    ? buildPatioTicketWhatsAppMessage({
        kind,
        companyName,
        code,
        plate,
        totalAmount,
        publicUrl,
      })
    : "";

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setStatus("Link copiado.");
    } catch {
      setStatus("Não foi possível copiar. Selecione o link manualmente.");
    }
  };

  const copyMessage = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setStatus("Mensagem copiada. Cole no WhatsApp se precisar.");
    } catch {
      setStatus("Não foi possível copiar a mensagem.");
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Gerando link e QR do ticket…</p>;
  }

  if (error || !token || !message) {
    return <Alert variant="error">{error ?? "Ticket público indisponível."}</Alert>;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Enviar ao cliente (WhatsApp + QR)</h2>
        <p className="mt-1 text-xs text-slate-600">
          Preferencial: o cliente recebe o link, apresenta o QR/celular na saída e evita impressão.
          A impressão térmica continua disponível abaixo, se precisar.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-slate-700">WhatsApp do cliente</span>
        <input
          className={glassField(false)}
          value={phoneDraft}
          onChange={(e) => setPhoneDraft(e.target.value)}
          placeholder="DDD + número"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <WhatsAppButton
          phone={phoneDraft}
          message={message}
          referenceType="patio_ticket"
          referenceId={entryId}
          className="inline-flex h-11 w-auto items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
          onOpenRequested={() => setStatus("Abertura do WhatsApp solicitada.")}
          onInvalidPhone={() =>
            setStatus("Informe o telefone do cliente (DDD + número) para abrir o WhatsApp.")
          }
        >
          <WhatsAppIcon className="h-5 w-5" />
          Enviar no WhatsApp
        </WhatsAppButton>
        <Button type="button" variant="secondary" onClick={() => void copyMessage()}>
          Copiar mensagem WhatsApp
        </Button>
        <Button type="button" variant="secondary" onClick={() => void copyLink()}>
          Copiar link
        </Button>
      </div>

      {status ? <p className="text-xs text-emerald-800">{status}</p> : null}

      <ProposalQrCode
        url={publicUrl}
        title="QR Code do comprovante"
        hint="O cliente escaneia e abre o comprovante no celular para apresentar na operação."
        compact={false}
      />
      <p className="break-all text-xs text-slate-500">{publicUrl}</p>
    </section>
  );
}
