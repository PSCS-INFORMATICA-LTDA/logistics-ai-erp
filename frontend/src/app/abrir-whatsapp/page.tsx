"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Fallback: o Chrome bloqueia whatsapp:// automático (sem clique do usuário).
 * Esta página só mostra o botão — o clique no &lt;a href="whatsapp://"&gt; é o que abre o app.
 */
export default function AbrirWhatsAppPage() {
  const [appHref, setAppHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const phone = (params.get("phone") || "").replace(/\D/g, "");
    const text = params.get("text") || "";

    if (phone.length < 10 || phone.length > 15) {
      setError("Telefone inválido para abrir o WhatsApp.");
      return;
    }

    setAppHref(
      text
        ? `whatsapp://send/?phone=${phone}&text=${encodeURIComponent(text)}`
        : `whatsapp://send/?phone=${phone}`
    );
  }, []);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold text-slate-900">Abrir WhatsApp do PC</h1>
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <p className="text-sm text-slate-600">
          Clique no botão verde abaixo para abrir o app (o Chrome não abre sozinho — precisa do
          clique). Não usa WhatsApp Web.
        </p>
      )}
      {appHref ? (
        <a
          href={appHref}
          className="inline-flex rounded-lg bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow hover:bg-emerald-700"
        >
          Abrir chat no app WhatsApp
        </a>
      ) : !error ? (
        <p className="text-sm text-slate-500">Preparando link…</p>
      ) : null}
      <p className="text-xs text-slate-500">
        Se o WhatsApp abrir na tela inicial, feche-o pela bandeja (Sair) e clique de novo no botão
        verde.
      </p>
      <Link href="/operacional/ordens-servico" className="text-sm font-medium text-red-700 underline">
        Voltar às ordens de serviço
      </Link>
    </main>
  );
}
