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
import type { CarWashServiceRow } from "@/lib/patio";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR, formatDateTimeBR } from "@/lib/utils";

export default function LavaRapidoTicketPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { companyId, company } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<CarWashServiceRow | null>(null);
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
        .from("car_wash_services")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (qError || !data) {
        setError(qError?.message ?? "Ordem de lava-rápido não encontrada.");
        setRow(null);
      } else {
        setRow(data as CarWashServiceRow);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, id, supabase]);

  if (loading) return <Loading />;
  if (error || !row) return <Alert variant="error">{error ?? "Ticket indisponível."}</Alert>;

  const lines = [
    { label: "Serviço", value: row.service_name },
    { label: "Data", value: formatDateBR(row.service_date) },
    { label: "Porte", value: row.vehicle_type || "—" },
  ];

  if (row.entry_date) {
    lines.push({
      label: "Entrada",
      value: formatDateTimeBR(row.entry_date, row.entry_time),
    });
  }
  if (row.exit_date) {
    lines.push({
      label: "Saída",
      value: formatDateTimeBR(row.exit_date, row.exit_time),
    });
  }
  if (row.payment_method) {
    lines.push({ label: "Pagamento", value: row.payment_method });
  }
  if (row.attendant) {
    lines.push({ label: "Atendente", value: row.attendant });
  }
  if (row.client_name) {
    lines.push({ label: "Cliente", value: row.client_name });
  }
  if (row.phone) {
    lines.push({ label: "Telefone", value: row.phone });
  }

  const companyName = companyDisplayName(company);
  const totalAmount = row.service_amount != null ? Number(row.service_amount) : null;

  return (
    <div className="space-y-4">
      <PatioTicketSharePanel
        source="car_wash"
        entryId={row.id}
        kind="lava-rapido"
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
        kind="lava-rapido"
        title="Lava-rápido"
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
            ? "Ordem em andamento — comprovante provisório."
            : "Comprovante de lava-rápido."
        }
        backHref="/operacional/lava-rapido"
        paper={paper}
      />
    </div>
  );
}
