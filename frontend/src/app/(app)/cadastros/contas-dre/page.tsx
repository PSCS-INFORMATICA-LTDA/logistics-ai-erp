"use client";

import { useState } from "react";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";
import { DRE_SEED } from "@/lib/dre-seed";
import type { DreAccount } from "@/types/database";
import {
  DRE_CLASSIFICATIONS,
  STATUS_OPTIONS,
  TRANSACTION_TYPES,
} from "@/types/database";

function ImportDreButton({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supabase = createClient();

  const handleImport = async () => {
    if (!companyId || !confirm(`Importar contas DRE da planilha?\n\nCódigos/nomes já cadastrados serão ignorados.`)) return;
    setLoading(true);
    setMsg(null);

    const { data: existing, error: existingError } = await supabase
      .from("chart_of_accounts")
      .select("name")
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (existingError) {
      setLoading(false);
      setMsg(existingError.message);
      return;
    }

    const existingNames = new Set((existing ?? []).map((row) => row.name));
    const pending = DRE_SEED.filter((row) => !existingNames.has(row.name));

    if (pending.length === 0) {
      setLoading(false);
      setMsg("Todas as contas DRE já estão cadastradas.");
      onDone();
      return;
    }

    const rows = pending.map((r) => ({
      company_id: companyId,
      name: r.name,
      classification: r.classification,
      transaction_type: r.transaction_type,
      status: "Ativo",
    }));
    const { error } = await supabase.from("chart_of_accounts").upsert(rows, {
      onConflict: "company_id,name",
      ignoreDuplicates: true,
    });
    setLoading(false);
    if (error) setMsg(error.message);
    else {
      const skipped = DRE_SEED.length - pending.length;
      setMsg(
        `${pending.length} conta(s) importada(s).` +
          (skipped > 0 ? ` ${skipped} já existiam (ignoradas).` : "")
      );
      onDone();
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" onClick={handleImport} disabled={loading}>
        {loading ? "Importando..." : "Importar da planilha"}
      </Button>
      {msg && <span className="text-sm text-green-700">{msg}</span>}
    </div>
  );
}

export default function ContasDrePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("cadastros.contas-dre");

  return (
    <div className="space-y-4">
      {canEdit ? <ImportDreButton onDone={() => setRefreshKey((k) => k + 1)} /> : null}
      <CrudPage<DreAccount>
        key={refreshKey}
      title="Contas DRE"
      description="Plano de contas gerencial — classificação e tipo derivados automaticamente nos lançamentos"
      table="chart_of_accounts"
      auditScreenKey="cadastros.contas-dre"
      softDelete={false}
      orderBy="name"
      compactTable
      cardsOnMobile
      columns={[
        { key: "name", label: "Conta DRE" },
        {
          key: "classification",
          label: "Classificação",
          className: "hidden md:table-cell",
        },
        {
          key: "transaction_type",
          label: "Tipo",
          className: "hidden lg:table-cell",
        },
        {
          key: "status",
          label: "Status",
          className: "hidden sm:table-cell",
          render: (r) => (
            <Badge variant={r.status === "Ativo" ? "success" : "default"}>{r.status}</Badge>
          ),
        },
      ]}
      renderForm={({ item, onSave, onCancel, saving }) => (
        <EntityForm
          saving={saving}
          onCancel={onCancel}
          initial={{
            name: item?.name ?? "",
            classification: item?.classification ?? "Operacional",
            transaction_type: item?.transaction_type ?? "Despesa",
            status: item?.status ?? "Ativo",
          }}
          onSubmit={onSave}
        >
          {({ form, set }) => (
            <FormFields
              form={form}
              set={set}
              fields={[
                { name: "name", label: "Conta DRE", required: true },
                {
                  name: "classification",
                  label: "Classificação",
                  type: "select",
                  options: DRE_CLASSIFICATIONS.map((c) => ({ value: c, label: c })),
                },
                {
                  name: "transaction_type",
                  label: "Tipo",
                  type: "select",
                  options: TRANSACTION_TYPES.map((t) => ({ value: t, label: t })),
                },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
                },
              ]}
            />
          )}
        </EntityForm>
      )}
    />
    </div>
  );
}
