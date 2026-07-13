"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Alert, Badge } from "@/components/ui/Badge";
import { nextCode } from "@/lib/codes";
import { useCompany } from "@/lib/company-context";
import { softDeletePartnerByCode } from "@/lib/partners";
import type { Partner } from "@/types/database";
import { PARTNER_TYPES, STATUS_OPTIONS } from "@/types/database";

function SociosPageContent() {
  const { companyId, loading: companyLoading } = useCompany();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const deleteCode = searchParams.get("deleteCode");
    if (!deleteCode || companyLoading || !companyId) return;

    let cancelled = false;

    (async () => {
      const result = await softDeletePartnerByCode(companyId, deleteCode);
      if (cancelled) return;

      router.replace("/cadastros/socios");

      if (result.ok) {
        setActionMsg(`Sócio ${result.code} (${result.name}) excluído com sucesso.`);
        setActionError(null);
        setRefreshKey((k) => k + 1);
      } else {
        setActionError(result.reason);
        setActionMsg(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId, companyLoading, router, searchParams]);

  return (
    <div className="space-y-4">
      {actionMsg && <Alert variant="info">{actionMsg}</Alert>}
      {actionError && <Alert variant="error">{actionError}</Alert>}

      <CrudPage<Partner>
        key={refreshKey}
        title="Sócios"
        description="Cadastro de sócios e responsáveis — base para rateio societário"
        table="partners"
        orderBy="code"
        eqFilters={{ status: "Ativo" }}
        columns={[
          { key: "code", label: "Código" },
          { key: "name", label: "Nome completo" },
          { key: "cpf", label: "CPF/CNPJ" },
          { key: "partner_type", label: "Tipo" },
          {
            key: "status",
            label: "Status",
            render: (r) => (
              <Badge variant={r.status === "Ativo" ? "success" : "default"}>{r.status}</Badge>
            ),
          },
          {
            key: "use_in_allocation",
            label: "Rateio",
            render: (r) => (r.use_in_allocation ? "Sim" : "Não"),
          },
        ]}
        renderForm={({ item, onSave, onCancel, saving }) => (
          <EntityForm
            saving={saving}
            onCancel={onCancel}
            initial={{
              code: item?.code ?? "",
              name: item?.name ?? "",
              partner_type: item?.partner_type ?? "Socio",
              status: item?.status ?? "Ativo",
              use_in_allocation: item?.use_in_allocation ?? true,
              rg: item?.rg ?? "",
              cpf: item?.cpf ?? "",
              notes: item?.notes ?? "",
            }}
            onSubmit={async (data) => {
              if (!item?.id && companyId && !data.code) {
                data.code = await nextCode("partners", companyId, "SOC");
              }
              if (data.rg === "") data.rg = null;
              if (data.cpf === "") data.cpf = null;
              await onSave(data);
            }}
          >
            {({ form, set }) => (
              <FormFields
                form={form}
                set={set}
                fields={[
                  { name: "code", label: "Código", required: true },
                  {
                    name: "name",
                    label: "Nome completo",
                    required: true,
                    colSpan: 2,
                    placeholder: "Nome completo do sócio",
                  },
                  {
                    name: "partner_type",
                    label: "Tipo",
                    type: "select",
                    options: PARTNER_TYPES.map((t) => ({ value: t, label: t })),
                  },
                  {
                    name: "status",
                    label: "Status",
                    type: "select",
                    options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
                  },
                  { name: "rg", label: "RG", placeholder: "Opcional para Empresa" },
                  {
                    name: "cpf",
                    label: "CPF / CNPJ",
                    placeholder: "CPF (sócio) ou CNPJ (empresa)",
                  },
                  { name: "use_in_allocation", label: "Usar em rateio?", type: "checkbox" },
                  { name: "notes", label: "Observações", type: "textarea", colSpan: 2 },
                ]}
              />
            )}
          </EntityForm>
        )}
      />
    </div>
  );
}

export default function SociosPage() {
  return (
    <Suspense fallback={null}>
      <SociosPageContent />
    </Suspense>
  );
}
