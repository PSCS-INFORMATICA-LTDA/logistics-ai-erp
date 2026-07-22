"use client";

import { CnpjLookupSection } from "@/components/cadastros/CnpjLookupSection";
import { NumericCodeField } from "@/components/cadastros/NumericCodeField";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Badge } from "@/components/ui/Badge";
import { resolveEntityNumericCode } from "@/lib/codes";
import { useCompany } from "@/lib/company-context";
import { useSeedNumericCode } from "@/lib/use-seed-numeric-code";
import type { Supplier } from "@/types/database";
import { STATUS_OPTIONS, SUPPLIER_CATEGORIES } from "@/types/database";

function emptyToNull(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (data[key] === "") data[key] = null;
  }
}

export default function FornecedoresPage() {
  const { companyId } = useCompany();

  return (
    <CrudPage<Supplier>
      title="Fornecedores"
      description="Consulta CNPJ primeiro · código numérico sequencial de 8 dígitos (editável)"
      table="suppliers"
      auditScreenKey="cadastros.fornecedores"
      orderBy="name"
      columns={[
        { key: "code", label: "Código" },
        { key: "name", label: "Fornecedor" },
        { key: "category", label: "Categoria" },
        { key: "city", label: "Cidade" },
        {
          key: "cnpj_status",
          label: "Sit. CNPJ",
          render: (r) =>
            r.cnpj_status ? (
              <Badge variant={String(r.cnpj_status).toUpperCase().includes("ATIVA") ? "success" : "default"}>
                {r.cnpj_status}
              </Badge>
            ) : (
              "—"
            ),
        },
        {
          key: "status",
          label: "Status",
          render: (r) => (
            <Badge variant={r.status === "Ativo" ? "success" : "default"}>{r.status}</Badge>
          ),
        },
      ]}
      renderForm={({ item, onSave, onCancel, saving }) => (
        <SupplierForm
          item={item ?? null}
          companyId={companyId}
          saving={saving}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    />
  );
}

function SupplierForm({
  item,
  companyId,
  saving,
  onSave,
  onCancel,
}: {
  item: Partial<Supplier> | null;
  companyId: string | null;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { seedCode, codeReady } = useSeedNumericCode("suppliers", companyId, item);

  if (!codeReady) {
    return <p className="text-sm text-slate-500">Gerando próximo código...</p>;
  }

  return (
    <EntityForm
      key={item?.id ?? `new-${seedCode}`}
      saving={saving}
      onCancel={onCancel}
      initial={{
        code: seedCode,
        name: item?.name ?? "",
        category: item?.category ?? "Outros",
        document: item?.document ?? "",
        trade_name: item?.trade_name ?? "",
        state_registration: item?.state_registration ?? "",
        postal_code: item?.postal_code ?? "",
        street: item?.street ?? "",
        address_number: item?.address_number ?? "",
        address_complement: item?.address_complement ?? "",
        neighborhood: item?.neighborhood ?? "",
        city: item?.city ?? "",
        state: item?.state ?? "",
        address: item?.address ?? "",
        cnpj_status: item?.cnpj_status ?? "",
        cnpj_checked_at: item?.cnpj_checked_at ?? "",
        contact_name: item?.contact_name ?? "",
        phone: item?.phone ?? "",
        status: item?.status ?? "Ativo",
        notes: item?.notes ?? "",
      }}
      onSubmit={async (data) => {
        const resolved = resolveEntityNumericCode(data.code, { existingCode: item?.code });
        if (!resolved.ok) {
          window.alert("Informe um código numérico com até 8 dígitos (ex.: 00000001).");
          return;
        }
        data.code = resolved.code;
        emptyToNull(data, [
          "document",
          "trade_name",
          "state_registration",
          "postal_code",
          "street",
          "address_number",
          "address_complement",
          "neighborhood",
          "city",
          "state",
          "address",
          "cnpj_status",
          "cnpj_checked_at",
          "contact_name",
          "phone",
          "notes",
        ]);
        await onSave(data);
      }}
    >
      {({ form, set }) => (
        <>
          <CnpjLookupSection form={form} set={set} />

          <NumericCodeField
            value={String(form.code ?? "")}
            onChange={(v) => set("code", v)}
          />

          <FormFields
            form={form}
            set={set}
            fields={[
              { name: "name", label: "Razão social / Fornecedor", required: true },
              { name: "trade_name", label: "Nome fantasia" },
              {
                name: "category",
                label: "Categoria",
                type: "select",
                options: SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: c })),
              },
              { name: "state_registration", label: "Inscrição estadual (IE)" },
              { name: "postal_code", label: "CEP" },
              { name: "street", label: "Logradouro", colSpan: 2 },
              { name: "address_number", label: "Número" },
              { name: "address_complement", label: "Complemento" },
              { name: "neighborhood", label: "Bairro" },
              { name: "city", label: "Cidade" },
              { name: "state", label: "UF" },
              { name: "address", label: "Endereço completo", colSpan: 2 },
              { name: "contact_name", label: "Contato" },
              { name: "phone", label: "Telefone" },
              {
                name: "status",
                label: "Status no cadastro",
                type: "select",
                options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
              },
              { name: "notes", label: "Observações", type: "textarea" },
            ]}
          />
        </>
      )}
    </EntityForm>
  );
}
