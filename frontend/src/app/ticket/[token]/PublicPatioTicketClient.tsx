"use client";

import { useEffect, useMemo, useState } from "react";
import { PatioMiniTicket } from "@/components/operacional/PatioMiniTicket";
import { Alert, Loading } from "@/components/ui/Badge";
import { formatParkingDateBR } from "@/lib/patio";
import { fetchPublicPatioTicket } from "@/lib/patio-ticket-api";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR, formatDateTimeBR } from "@/lib/utils";

type Props = {
  token: string;
};

export function PublicPatioTicketClient({ token }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("Empresa");
  const [companyDocument, setCompanyDocument] = useState<string | null>(null);
  const [kind, setKind] = useState<"estacionamento" | "lava-rapido">("estacionamento");
  const [ticket, setTicket] = useState<Record<string, unknown> | null>(null);
  const [paper, setPaper] = useState<"58mm" | "80mm">("58mm");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await fetchPublicPatioTicket(supabase, token);
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError);
        setTicket(null);
        setLoading(false);
        return;
      }
      if (!data?.found || !data.ticket || !data.kind) {
        setError("Comprovante não encontrado ou link inválido.");
        setTicket(null);
        setLoading(false);
        return;
      }
      setKind(data.kind);
      setCompanyName(data.company_name || "Empresa");
      setCompanyDocument(data.company_document ?? null);
      setTicket(data.ticket);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, token]);

  if (loading) return <Loading />;
  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-md p-4">
        <Alert variant="error">{error ?? "Comprovante indisponível."}</Alert>
      </div>
    );
  }

  const code = String(ticket.code ?? "—");
  const plate = String(ticket.plate ?? "—");
  const status = String(ticket.status ?? "—");
  const lines: { label: string; value: string }[] = [];
  let total: number | null = null;

  if (kind === "estacionamento") {
    lines.push({ label: "Cobrança", value: String(ticket.billing_mode ?? "—") });
    lines.push({ label: "Porte", value: String(ticket.vehicle_type ?? "—") });
    lines.push({
      label: "Entrada",
      value: formatDateTimeBR(
        ticket.entry_date as string | null,
        ticket.entry_time as string | null
      ),
    });
    if (ticket.billing_mode === "Mensal") {
      lines.push({
        label: "Vigência até",
        value: formatParkingDateBR(ticket.period_end_date as string | null),
      });
      lines.push({
        label: "Próx. cobrança",
        value: formatParkingDateBR(ticket.next_charge_date as string | null),
      });
    }
    if (ticket.exit_date) {
      lines.push({
        label: "Saída",
        value: formatDateTimeBR(
          ticket.exit_date as string | null,
          ticket.exit_time as string | null
        ),
      });
    }
    if (ticket.daily_count != null) {
      lines.push({
        label: ticket.billing_mode === "Rotativo" ? "Horas" : "Diárias",
        value: String(ticket.daily_count),
      });
    }
    if (ticket.client_name) {
      lines.push({ label: "Cliente", value: String(ticket.client_name) });
    }
    total =
      ticket.total_amount != null && ticket.total_amount !== ""
        ? Number(ticket.total_amount)
        : null;
  } else {
    lines.push({ label: "Serviço", value: String(ticket.service_name ?? "—") });
    lines.push({
      label: "Data",
      value: formatDateBR(ticket.service_date as string | null),
    });
    lines.push({ label: "Porte", value: String(ticket.vehicle_type ?? "—") });
    if (ticket.payment_method) {
      lines.push({ label: "Pagamento", value: String(ticket.payment_method) });
    }
    if (ticket.attendant) {
      lines.push({ label: "Atendente", value: String(ticket.attendant) });
    }
    if (ticket.client_name) {
      lines.push({ label: "Cliente", value: String(ticket.client_name) });
    }
    total =
      ticket.service_amount != null && ticket.service_amount !== ""
        ? Number(ticket.service_amount)
        : null;
  }

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-6">
      <div className="mx-auto mb-4 max-w-md rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950 print:hidden">
        Apresente este comprovante na saída/retirada. Você também pode salvar o link ou imprimir se
        precisar.
      </div>
      <div className="patio-ticket-toolbar mx-auto mb-3 flex max-w-md flex-wrap gap-2 print:hidden">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Papel
          <select
            className="rounded-lg border border-slate-300 px-2 py-1"
            value={paper}
            onChange={(e) => setPaper(e.target.value as "58mm" | "80mm")}
          >
            <option value="58mm">58 mm</option>
            <option value="80mm">80 mm</option>
          </select>
        </label>
      </div>
      <PatioMiniTicket
        kind={kind}
        title={kind === "estacionamento" ? "Estacionamento" : "Lava-rápido"}
        companyName={companyName}
        companyDocument={companyDocument}
        code={code}
        plate={plate}
        status={status}
        lines={lines}
        totalAmount={total}
        footerNote="Comprovante digital — apresente na operação."
        backHref="#"
        paper={paper}
      />
      {total != null ? (
        <p className="sr-only">{formatCurrency(total)}</p>
      ) : null}
    </div>
  );
}
