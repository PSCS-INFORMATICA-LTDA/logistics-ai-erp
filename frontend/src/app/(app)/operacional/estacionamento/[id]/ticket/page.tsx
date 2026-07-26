"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Loading } from "@/components/ui/Badge";
import { PatioMiniTicket } from "@/components/operacional/PatioMiniTicket";
import { PatioTicketSharePanel } from "@/components/operacional/PatioTicketSharePanel";
import { useCompany } from "@/lib/company-context";
import {
  companyDisplayName,
  DEFAULT_COMPANY_LOGO_SRC,
  getCompanyLogoUrl,
} from "@/lib/company-logo";
import {
  formatParkingDateBR,
  type ParkingEntryRow,
} from "@/lib/patio";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateTimeBR } from "@/lib/utils";

export default function EstacionamentoTicketPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { companyId, company } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<ParkingEntryRow | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<"58mm" | "80mm">("58mm");

  useEffect(() => {
    void getCompanyLogoUrl(company?.logo_storage_path).then((url) =>
      setLogoUrl(url || DEFAULT_COMPANY_LOGO_SRC)
    );
  }, [company?.logo_storage_path]);

  useEffect(() => {
    if (!companyId || !id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const { data, error: qError } = await supabase
        .from("parking_entries")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (qError || !data) {
        setError(qError?.message ?? "Ordem de estacionamento não encontrada.");
        setRow(null);
      } else {
        setRow(data as ParkingEntryRow);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, id, supabase]);

  if (loading) return <Loading />;
  if (error || !row) return <Alert variant="error">{error ?? "Ticket indisponível."}</Alert>;

  const mode = row.billing_mode || "Diária";
  const lines = [
    { label: "Cobrança", value: String(mode) },
    { label: "Porte", value: row.vehicle_type || "—" },
    {
      label: "Entrada",
      value: formatDateTimeBR(row.entry_date, row.entry_time),
    },
  ];

  if (mode === "Mensal") {
    lines.push(
      { label: "Vigência até", value: formatParkingDateBR(row.period_end_date) },
      { label: "Próx. cobrança", value: formatParkingDateBR(row.next_charge_date) }
    );
  }

  if (row.exit_date) {
    lines.push({
      label: "Saída",
      value: formatDateTimeBR(row.exit_date, row.exit_time),
    });
  }

  if (row.daily_count != null && mode === "Rotativo") {
    lines.push({
      label: "Horas",
      value: String(row.daily_count),
    });
  } else if (row.daily_count != null && mode === "Diária") {
    lines.push({
      label: "Diárias",
      value: String(row.daily_count),
    });
  }

  if (row.daily_rate != null) {
    lines.push({
      label: mode === "Rotativo" ? "1ª hora" : "Tarifa",
      value: formatCurrency(Number(row.daily_rate)),
    });
  }

  if (row.client_name) {
    lines.push({ label: "Cliente", value: row.client_name });
  }

  const companyName = companyDisplayName(company);
  const totalAmount = row.total_amount != null ? Number(row.total_amount) : null;

  return (
    <div className="space-y-4">
      <PatioTicketSharePanel
        source="parking"
        entryId={row.id}
        kind="estacionamento"
        companyName={companyName}
        code={row.code}
        plate={row.plate}
        phone={row.phone}
        totalAmount={totalAmount}
      />

      <div className="patio-ticket-toolbar flex flex-wrap gap-2 print:hidden">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Papel (impressão opcional)
          <select
            className="rounded-lg border border-slate-300 px-2 py-1"
            value={paper}
            onChange={(e) => setPaper(e.target.value as "58mm" | "80mm")}
          >
            <option value="58mm">58 mm (mini)</option>
            <option value="80mm">80 mm</option>
          </select>
        </label>
      </div>
      <PatioMiniTicket
        kind="estacionamento"
        title="Estacionamento"
        companyName={companyName}
        companyDocument={company?.document}
        logoUrl={logoUrl}
        code={row.code}
        plate={row.plate}
        status={row.status}
        lines={lines}
        totalAmount={totalAmount}
        footerNote={
          row.status === "Aberto"
            ? "Ticket de entrada — apresente na saída."
            : "Comprovante de estacionamento."
        }
        backHref="/operacional/estacionamento"
        paper={paper}
      />
    </div>
  );
}
