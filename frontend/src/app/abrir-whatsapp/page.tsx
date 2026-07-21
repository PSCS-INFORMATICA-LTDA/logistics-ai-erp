"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  copyTextToClipboardSync,
  formatWhatsAppPhoneDisplay,
  sendWhatsAppDesktopMessage,
} from "@/lib/service-order-proposal";

/**
 * Envio Windows: Compartilhar do sistema + cópia da mensagem.
 * Não usa WhatsApp Web (abre chat errado / corta texto).
 */
export default function AbrirWhatsAppPage() {
  const [phone, setPhone] = useState("");
  const [fullMessage, setFullMessage] = useState("");
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

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      setError("Telefone inválido para abrir o WhatsApp.");
      return;
    }

    setPhone(phoneDigits);
    setFullMessage(full);
    if (full) copyTextToClipboardSync(full);
  }, []);

  const phoneLabel = formatWhatsAppPhoneDisplay(phone) || phone;

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
      title: "Designação GRX",
    });
    setBusy(false);

    if (result.mode === "share") {
      setStatus(
        `Escolha WhatsApp no Compartilhar. Depois pesquise ${phoneLabel} / ${phone} (telefone do motorista) e envie.`
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
            Motorista: <strong>{phoneLabel}</strong>
            <span className="text-slate-500"> ({phone})</span>
          </p>
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            1) Compartilhar → <strong>WhatsApp</strong>
            <br />
            2) Pesquise o telefone do motorista: <strong>{phoneLabel}</strong> ({phone})
            <br />
            3) Envie (a mensagem completa já vai no compartilhamento)
          </p>
        </>
      )}

      {!error && phone ? (
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            disabled={busy || !fullMessage}
            onClick={() => void handleSend()}
            className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "Abrindo…" : "Copiar e enviar no WhatsApp"}
          </button>
          <button
            type="button"
            onClick={copyMessage}
            className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            {copied ? "Mensagem copiada" : "Só copiar mensagem completa"}
          </button>

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
