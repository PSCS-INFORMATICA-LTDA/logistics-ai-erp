"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  copyPreparedEmailHtmlToClipboardAsync,
  copyRichHtmlFromElement,
  openMailtoLink,
} from "@/lib/service-order-proposal";

export type EmailShareDialogData = {
  subject: string;
  plainBody: string;
  htmlForClipboard: string;
  mailtoHref: string;
  hasQr: boolean;
  hasLogo: boolean;
};

type EmailShareDialogProps = {
  data: EmailShareDialogData | null;
  onClose: () => void;
};

export function EmailShareDialog({ data, onClose }: EmailShareDialogProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const handleCopy = useCallback(() => {
    if (!data || !previewRef.current) return;

    setCopyError(false);
    const fromVisible =
      copyRichHtmlFromElement(previewRef.current) ||
      copyRichHtmlFromElement(previewRef.current, { selectAll: true });

    if (fromVisible) {
      setCopied(true);
      return;
    }

    void copyPreparedEmailHtmlToClipboardAsync(data.htmlForClipboard, data.plainBody).then((ok) => {
      setCopied(ok);
      setCopyError(!ok);
    });
  }, [data]);

  const handleOpenGmail = useCallback(() => {
    if (!data) return;
    if (!copied) {
      handleCopy();
    }
    openMailtoLink(data.mailtoHref);
  }, [copied, data, handleCopy]);

  if (!data) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-share-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 id="email-share-title" className="text-lg font-semibold text-slate-900">
            Enviar proposta por e-mail
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            O Gmail só aceita texto pelo botão — QR Code e logo 3D vão com{" "}
            <strong>Ctrl+V</strong> depois de copiar abaixo.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Clique <strong>Copiar QR + logo 3D</strong> (você verá a confirmação).
            </li>
            <li>
              Clique <strong>Abrir Gmail</strong> — abre com assunto e texto.
            </li>
            <li>
              No corpo do e-mail, clique uma vez e pressione <strong>Ctrl+V</strong>.
            </li>
          </ol>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Prévia (QR + logo 3D GRX)
            </p>
            <div
              ref={previewRef}
              className="max-h-64 overflow-y-auto rounded border border-white bg-white p-3 text-sm text-slate-800"
              dangerouslySetInnerHTML={{ __html: data.htmlForClipboard }}
            />
            {!data.hasLogo && (
              <p className="mt-2 text-xs text-amber-700">
                Logo não carregou — recarregue a página (F5) e tente de novo.
              </p>
            )}
          </div>

          {copied && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
              Copiado! Agora abra o Gmail e use Ctrl+V no corpo do e-mail.
            </p>
          )}
          {copyError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              Não foi possível copiar automaticamente. Selecione a prévia acima com o mouse,
              Ctrl+C, e cole no Gmail.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-4">
          <Button type="button" onClick={handleCopy}>
            {copied ? "Copiado novamente" : "Copiar QR + logo 3D"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleOpenGmail}>
            Abrir Gmail
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
