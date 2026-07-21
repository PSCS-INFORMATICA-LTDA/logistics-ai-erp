"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { copyTextToClipboardSync } from "@/lib/service-order-proposal";

/**
 * Ponte Windows: o clique precisa disparar o protocolo de forma agressiva.
 * Quando o Chrome bloqueia whatsapp:// (nada acontece), oferece o link Meta
 * para o Windows perguntar qual app abrir (escolher o Desktop, não o Web).
 */
export default function AbrirWhatsAppPage() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [chatOnlyHref, setChatOnlyHref] = useState<string | null>(null);
  const [withTextHref, setWithTextHref] = useState<string | null>(null);
  const [storeHref, setStoreHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const phoneDigits = (params.get("phone") || "").replace(/\D/g, "");
    const text = (params.get("text") || "").trim();

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      setError("Telefone inválido para abrir o WhatsApp.");
      return;
    }

    setPhone(phoneDigits);
    setMessage(text);
    setChatOnlyHref(`whatsapp://send?phone=${phoneDigits}`);
    setWithTextHref(
      text ? `whatsapp://send?phone=${phoneDigits}&text=${encodeURIComponent(text)}` : null
    );
    const encoded = encodeURIComponent(text || `Olá! Segue o contato GRX.`);
    setStoreHref(`https://api.whatsapp.com/send?phone=${phoneDigits}&text=${encoded}`);
  }, []);

  const launchNative = (href: string) => {
    if (message) copyTextToClipboardSync(message);

    // 1) Navegação direta — mais confiável que <a> em alguns Chromes.
    try {
      window.location.href = href;
    } catch {
      /* ignore */
    }

    // 2) iframe oculto — alguns Windows só reagem a este caminho.
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = href;
      document.body.appendChild(iframe);
      window.setTimeout(() => {
        try {
          iframe.remove();
        } catch {
          /* ignore */
        }
      }, 2500);
    } catch {
      /* ignore */
    }

    // 3) Âncora sintética como reforço.
    try {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch {
      /* ignore */
    }

    setTried(true);
    window.setTimeout(() => setShowFallback(true), 900);
  };

  const handleNativeClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    launchNative(href);
  };

  const handleFallbackClick = () => {
    if (message) copyTextToClipboardSync(message);
  };

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold text-slate-900">Abrir WhatsApp do PC</h1>
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Clique no botão verde para abrir o <strong>app</strong> no chat do número{" "}
            <strong>{phone || "…"}</strong>.
          </p>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Antes de clicar: se o WhatsApp já estiver aberto, clique com o botão direito no ícone da
            bandeja → <strong>Sair</strong>. Com o app aberto, o Windows muitas vezes ignora o link
            (parece que «nada acontece»).
          </p>
        </>
      )}

      {chatOnlyHref ? (
        <div className="flex w-full flex-col gap-2">
          <a
            href={chatOnlyHref}
            onClick={(event) => handleNativeClick(event, chatOnlyHref)}
            className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow hover:bg-emerald-700"
          >
            Abrir chat no app WhatsApp
          </a>
          {withTextHref ? (
            <a
              href={withTextHref}
              onClick={(event) => handleNativeClick(event, withTextHref)}
              className="inline-flex w-full items-center justify-center rounded-lg border border-emerald-700 bg-white px-5 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
            >
              Tentar de novo com a mensagem no texto
            </a>
          ) : null}

          {tried ? (
            <p className="text-xs text-slate-600">
              Tentativa enviada ao Windows. Se o WhatsApp não mudou de tela, use o botão abaixo.
            </p>
          ) : null}

          {showFallback && storeHref ? (
            <div className="mt-2 w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-800">
                Nada abriu? Use o atalho do Windows:
              </p>
              <p className="text-xs text-slate-600">
                O sistema vai perguntar qual app abrir. Escolha <strong>WhatsApp</strong> (o do PC),
                não o navegador / WhatsApp Web.
              </p>
              <a
                href={storeHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleFallbackClick}
                className="inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Abrir pelo Windows (escolher app WhatsApp)
              </a>
            </div>
          ) : null}

          <p className="text-xs text-slate-600">
            A mensagem da designação é copiada no clique. Se a caixa do WhatsApp vier vazia, Ctrl+V
            no chat do motorista.
          </p>
          <p className="text-xs text-slate-500">
            Se o Chrome bloqueou o protocolo: cadeado na barra de endereço → configurações do site →
            permitir abrir WhatsApp / links externos.
          </p>
        </div>
      ) : !error ? (
        <p className="text-sm text-slate-500">Preparando link…</p>
      ) : null}

      <Link href="/operacional/ordens-servico" className="text-sm font-medium text-red-700 underline">
        Voltar às ordens de serviço
      </Link>
    </main>
  );
}
