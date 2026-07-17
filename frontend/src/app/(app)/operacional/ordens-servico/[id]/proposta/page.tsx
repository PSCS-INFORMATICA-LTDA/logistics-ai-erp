"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ServiceOrderProposalView } from "@/components/operacional/ServiceOrderProposalView";
import { Loading, Alert } from "@/components/ui/Badge";
import { useCompany } from "@/lib/company-context";
import { companyDisplayName, getCompanyLogoUrl } from "@/lib/company-logo";
import { createClient } from "@/lib/supabase/client";
import type { ServiceOrder } from "@/types/database";

export default function ServiceOrderPropostaPage() {
  const params = useParams();
  const orderId = String(params.id ?? "");
  const { company } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [driverName, setDriverName] = useState<string | null>(null);
  const [dreAccountName, setDreAccountName] = useState<string | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = await getCompanyLogoUrl(company?.logo_storage_path);
      if (!cancelled) setCompanyLogoUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [company?.logo_storage_path]);

  useEffect(() => {
    if (!orderId) {
      setError("Ordem de serviço não informada.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("service_orders")
        .select("*")
        .eq("id", orderId)
        .single();

      if (cancelled) return;

      if (fetchError || !data) {
        setError(fetchError?.message ?? "Ordem de serviço não encontrada.");
        setLoading(false);
        return;
      }

      const row = data as ServiceOrder;
      setOrder(row);
      setLoading(false);

      const [driverRes, accountRes] = await Promise.all([
        row.driver_id
          ? supabase.from("drivers").select("name").eq("id", row.driver_id).maybeSingle()
          : Promise.resolve({ data: null }),
        row.chart_of_account_id
          ? supabase
              .from("chart_of_accounts")
              .select("name")
              .eq("id", row.chart_of_account_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (cancelled) return;

      setDriverName((driverRes.data as { name?: string } | null)?.name ?? null);
      setDreAccountName((accountRes.data as { name?: string } | null)?.name ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, supabase]);

  if (loading) {
    return (
      <div className="space-y-3 py-12 text-center">
        <Loading />
        <p className="text-sm text-slate-500">Carregando proposta...</p>
      </div>
    );
  }
  if (error || !order) return <Alert variant="error">{error ?? "OS não encontrada."}</Alert>;

  return (
    <div className="space-y-4">
      <Link
        href="/operacional/ordens-servico"
        className="proposal-toolbar text-sm text-brand-700 underline print:hidden"
      >
        ← Voltar às ordens de serviço
      </Link>
      <ServiceOrderProposalView
        order={order}
        context={{
          companyName: companyDisplayName(company),
          companyLogoUrl,
          driverName,
          dreAccountName,
        }}
        proposalResponse={order.proposal_response ?? "pending"}
        onProposalUpdated={(patch) => setOrder((prev) => (prev ? { ...prev, ...patch } : prev))}
      />
    </div>
  );
}
