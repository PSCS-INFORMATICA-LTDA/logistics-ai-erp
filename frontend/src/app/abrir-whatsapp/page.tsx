"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import {
  copyTextToClipboardSync,
  formatWhatsAppPhoneDisplay,
  sendWhatsAppDesktopMessage,
  type WhatsAppRecipientRole,
} from "@/lib/service-order-proposal";

function parseRecipient(raw: string | null): WhatsAppRecipientRole {
  if (raw === "motorista" || raw === "cliente" || raw === "contato") return raw;
  return "contato";
}

function recipientNoun(role: WhatsAppRecipientRole): string {
  if (role === "motorista") return "motorista";
  if (role === "cliente") return "cliente";
  return "contato";
}

/**
 * Envio Windows: Compartilhar do sistema + cópia da mensagem.
 * Não usa WhatsApp Web (abre chat errado / corta texto).
 */
export default function AbrirWhatsAppPage() {
  const [phone, setPhone] = useState("");
  const [fullMessage, setFullMessage] = useState("");
  const [recipient, setRecipient] = useState<WhatsAppRecipientRole>("contato");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const phoneDigits = (params.get("phone") || "").replace(/\D/g, "");
    const text = (params.get("text") || "").trim();
    const full = (params.get("full") || text).trim();
    const to = parseRecipient(params.get("to"));

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      setError("Telefone inválido para abrir o WhatsApp.");
      return;
    }

    setPhone(phoneDigits);
    setFullMessage(full);
    setRecipient(to);
    if (full) copyTextToClipboardSync(full);
  }, []);

  const phoneLabel = formatWhatsAppPhoneDisplay(phone) || phone;
  const who = recipientNoun(recipient);

  const copyMessage = () => {
    if (!fullMessage) return;
    const ok = copyTextToClipboardSync(fullMessage);
    setCopied(ok);
    setStatus(ok ? "Mensagem completa copiada." : "Não foi possível copiar.");
    window.setTimeout(() => setCopied(false), 2500);
  };

  const handleSend = async () => {
    if (!phone || !fullMessage || busy) return;
    setBusy(true);
    setStatus(null);
    const result = await sendWhatsAppDesktopMessage({
      message: fullMessage,
      phoneDigits: phone,
      title: "WhatsApp GRX",
      recipient,
    });
    setBusy(false);

    if (result.mode === "share") {
      setStatus(
        `Escolha WhatsApp no Compartilhar. Depois pesquise ${phoneLabel} / ${phone} (telefone do ${who}) e envie.`
      );
      return;
    }
    if (result.mode === "cancelled") {
      setStatus(
        `Compartilhar cancelado. Mensagem copiada — no WhatsApp busque ${phoneLabel} e Ctrl+V.`
      );
      return;
    }
    if (result.mode === "protocol") {
      setStatus(
        `App aberto. Confira o chat de ${phoneLabel}; se precisar, Ctrl+V.`
      );
      return;
    }
    setStatus(`Mensagem copiada. No WhatsApp busque ${phoneLabel} e Ctrl+V.`);
  };

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold text-slate-900">Enviar no WhatsApp do PC</h1>
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {who.charAt(0).toUpperCase() + who.slice(1)}: <strong>{phoneLabel}</strong>
            <span className="text-slate-500"> ({phone})</span>
          </p>
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            1) Clique em <strong>Copiar e enviar no WhatsApp</strong>
            <br />
            2) Escolha WhatsApp e busque o telefone do {who}:{" "}
            <strong>{phoneLabel}</strong> ({phone})
            <br />
            3) Envie (a mensagem já vai no compartilhamento; se precisar, Ctrl+V)
          </p>
        </>
      )}

      {!error && phone ? (
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            variant="moss"
            className="w-full px-5 py-3 text-base font-semibold"
            disabled={busy || !fullMessage}
            onClick={() => void handleSend()}
          >
            {busy ? "Abrindo…" : "Copiar e enviar no WhatsApp"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full px-5 py-3 text-sm font-semibold"
            onClick={copyMessage}
          >
            {copied ? "Mensagem copiada" : "Só copiar mensagem completa"}
          </Button>

          {fullMessage ? (
            <textarea
              readOnly
              rows={10}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
              value={fullMessage}
            />
          ) : null}

          {status ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {status}
            </p>
          ) : null}
        </div>
      ) : !error ? (
        <p className="text-sm text-slate-500">Preparando…</p>
      ) : null}

      <Link href="/operacional/ordens-servico" className="text-sm font-medium text-red-700 underline">
        Voltar às ordens de serviço
      </Link>
    </main>
  );
}
