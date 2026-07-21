"use client";

import { CnpjLookupSection } from "@/components/cadastros/CnpjLookupSection";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Badge } from "@/components/ui/Badge";
import { nextCode } from "@/lib/codes";
import { useCompany } from "@/lib/company-context";
import type { Client } from "@/types/database";
import { STATUS_OPTIONS } from "@/types/database";

function emptyToNull(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (data[key] === "") data[key] = null;
  }
}

export default function ClientesPage() {
  const { companyId } = useCompany();

  return (
    <CrudPage<Client>
      title="Clientes"
      description="Quem gera receita — consulta CNPJ preenche razão social, endereço e situação cadastral"
      table="clients"
      auditScreenKey="cadastros.clientes"
      orderBy="name"
      columns={[
        { key: "code", label: "Código" },
        { key: "name", label: "Nome" },
        { key: "document", label: "CNPJ/CPF" },
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
        <EntityForm
          saving={saving}
          onCancel={onCancel}
          initial={{
            code: item?.code ?? "",
            name: item?.name ?? "",
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
            if (!item?.id && companyId && !data.code) {
              data.code = await nextCode("clients", companyId, "CLI");
            }
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
              <FormFields
                form={form}
                set={set}
                fields={[
                  { name: "code", label: "Código", required: true },
                  { name: "name", label: "Razão social / Nome", required: true },
                  { name: "trade_name", label: "Nome fantasia" },
                ]}
              />

              <CnpjLookupSection form={form} set={set} />

              <FormFields
                form={form}
                set={set}
                fields={[
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
      )}
    />
  );
}
