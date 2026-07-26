"use client";

import { Button } from "@/components/ui/Button";
import { DEFAULT_COMPANY_LOGO_SRC } from "@/lib/company-logo";
import { formatCurrency } from "@/lib/utils";

export type PatioTicketLine = {
  label: string;
  value: string;
};

export type PatioMiniTicketProps = {
  kind: "estacionamento" | "lava-rapido";
  title: string;
  companyName: string;
  companyDocument?: string | null;
  logoUrl?: string | null;
  code: string;
  plate: string;
  status: string;
  lines: PatioTicketLine[];
  totalLabel?: string;
  totalAmount?: number | null;
  footerNote?: string;
  backHref: string;
  /** Largura do papel da mini impressora. */
  paper?: "58mm" | "80mm";
};

export function PatioMiniTicket({
  kind,
  title,
  companyName,
  companyDocument,
  logoUrl,
  code,
  plate,
  status,
  lines,
  totalLabel = "TOTAL",
  totalAmount,
  footerNote = "Guarde este comprovante.",
  backHref,
  paper = "58mm",
}: PatioMiniTicketProps) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="patio-ticket-page space-y-4">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          @page { size: ${paper} auto; margin: 2mm; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          aside, .app-shell-header, .app-shell-sidebar, .patio-ticket-toolbar { display: none !important; }
          .app-shell-main, .app-shell-content, main {
            margin: 0 !important; padding: 0 !important; width: 100% !important;
            max-width: none !important; overflow: visible !important;
          }
          .patio-ticket-receipt {
            box-shadow: none !important; border: none !important;
            width: 100% !important; max-width: none !important;
          }
        }
      `,
        }}
      />

      <div className="patio-ticket-toolbar flex flex-wrap items-center gap-2 print:hidden">
        {backHref && backHref !== "#" ? (
          <a href={backHref} className="text-sm text-brand-700 underline">
            ← Voltar
          </a>
        ) : null}
        <Button type="button" onClick={handlePrint}>
          Imprimir ticket ({paper})
        </Button>
        <p className="w-full text-xs text-slate-500 sm:w-auto">
          Opcional: se precisar de papel, escolha {paper} na mini impressora.
        </p>
      </div>

      <article
        className={`patio-ticket-receipt mx-auto rounded-xl border border-slate-200 bg-white p-3 font-mono text-slate-900 shadow-sm ${
          paper === "80mm" ? "max-w-[80mm]" : "max-w-[58mm]"
        }`}
        data-kind={kind}
      >
        <header className="border-b border-dashed border-slate-400 pb-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl || DEFAULT_COMPANY_LOGO_SRC}
            alt=""
            className="mx-auto mb-1 h-10 w-auto object-contain"
          />
          <p className="text-[11px] font-bold uppercase leading-tight tracking-wide">
            {companyName}
          </p>
          {companyDocument ? (
            <p className="mt-0.5 text-[10px] text-slate-700">CNPJ {companyDocument}</p>
          ) : null}
          <p className="mt-2 text-[12px] font-bold uppercase">{title}</p>
          <p className="text-[10px] text-slate-600">Comprovante para o cliente</p>
        </header>

        <div className="space-y-1 border-b border-dashed border-slate-400 py-2 text-[11px] leading-snug">
          <Row label="Código" value={code} />
          <Row label="Placa" value={plate} strong />
          <Row label="Status" value={status} />
          {lines.map((line) => (
            <Row key={`${line.label}-${line.value}`} label={line.label} value={line.value} />
          ))}
        </div>

        <div className="border-b border-dashed border-slate-400 py-2 text-[12px]">
          <div className="flex items-baseline justify-between gap-2 font-bold">
            <span>{totalLabel}</span>
            <span className="tabular-nums">
              {totalAmount != null && Number.isFinite(totalAmount)
                ? formatCurrency(totalAmount)
                : "—"}
            </span>
          </div>
        </div>

        <footer className="pt-2 text-center text-[10px] leading-snug text-slate-700">
          <p>{footerNote}</p>
          <p className="mt-1">
            Emitido em{" "}
            {new Date().toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="mt-2 font-bold tracking-widest">***</p>
        </footer>
      </article>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-slate-600">{label}</span>
      <span className={`min-w-0 break-words text-right ${strong ? "font-bold" : ""}`}>
        {value || "—"}
      </span>
    </div>
  );
}
