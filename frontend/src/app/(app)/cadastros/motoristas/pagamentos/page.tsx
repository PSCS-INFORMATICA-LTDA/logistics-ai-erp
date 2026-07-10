"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DriverPaymentsTable } from "@/components/motoristas/DriverPaymentsTable";
import { Loading } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { fetchDriverPaymentRows, type DriverPaymentFilter } from "@/lib/driver-payments-api";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";

export default function MotoristasPagamentosPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchDriverPaymentRows>>["rows"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null);
  const [filter, setFilter] = useState<DriverPaymentFilter>("pending");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    setSchemaWarning(null);
    const { rows: data, error: fetchError, schemaWarning: warning } = await fetchDriverPaymentRows(
      supabase,
      companyId
    );
    if (fetchError) {
      setError(fetchError);
      setRows([]);
    } else {
      setRows(data);
      setSchemaWarning(warning);
    }
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader
        title="Acompanhamento de pagamentos"
        description="Dados do motorista e informações bancárias para o Rafael efetuar o pagamento. Anexe o comprovante e marque como pago."
      />
      <CardBody>
        {schemaWarning ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">Atenção</p>
            <p className="mt-1">{schemaWarning}</p>
          </div>
        ) : null}
        {loading ? (
          <Loading />
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <DriverPaymentsTable
            companyId={companyId ?? ""}
            supabase={supabase}
            rows={rows}
            filter={filter}
            layout="banking"
            showFilterTabs
            onFilterChange={setFilter}
            onRowsChange={setRows}
            emptyMessage="Nenhum pagamento pendente. Após o motorista confirmar a designação (ou concluir o frete), a OS aparecerá aqui com os dados para pagamento."
          />
        )}
      </CardBody>
    </Card>
  );
}
