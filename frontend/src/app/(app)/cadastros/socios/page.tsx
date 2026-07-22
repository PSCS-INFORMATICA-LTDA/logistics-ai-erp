"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Alert, Badge } from "@/components/ui/Badge";
import {
  documentKindForPartnerType,
  formatCnpj,
  formatCpf,
  formatRg,
  onlyDigits,
  validatePartnerDocument,
  validatePartnerRg,
} from "@/lib/br-documents";
import { NumericCodeField } from "@/components/cadastros/NumericCodeField";
import { useAccess } from "@/lib/access-context";
import { resolveEntityNumericCode } from "@/lib/codes";
import { useCompany } from "@/lib/company-context";
import { glassField } from "@/lib/liquid-glass-styles";
import { softDeletePartnerByCode } from "@/lib/partners";
import { useSeedNumericCode } from "@/lib/use-seed-numeric-code";
import type { Partner } from "@/types/database";
import { PARTNER_TYPES, STATUS_OPTIONS } from "@/types/database";

function SociosPageContent() {
  const { companyId, loading: companyLoading } = useCompany();
  const { canDeleteScreen, loading: accessLoading } = useAccess();
  const canDelete = canDeleteScreen("cadastros.socios");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const deleteCode = searchParams.get("deleteCode");
    if (!deleteCode || companyLoading || accessLoading || !companyId) return;

    let cancelled = false;

    (async () => {
      if (!canDelete) {
        router.replace("/cadastros/socios");
        setActionError("Seu acesso não inclui Exclusão nesta tela.");
        return;
      }
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
  }, [accessLoading, canDelete, companyId, companyLoading, router, searchParams]);

  return (
    <div className="space-y-4">
      {actionMsg && <Alert variant="info">{actionMsg}</Alert>}
      {actionError && <Alert variant="error">{actionError}</Alert>}

      <CrudPage<Partner>
        key={refreshKey}
        title="Sócios"
        description="Cadastro de sócios — código numérico sequencial de 8 dígitos (editável), RG e CPF/CNPJ"
        table="partners"
        auditScreenKey="cadastros.socios"
        orderBy="code"
        eqFilters={{ status: "Ativo" }}
        columns={[
          { key: "code", label: "Código" },
          { key: "name", label: "Nome completo" },
          { key: "cpf", label: "CPF/CNPJ" },
          { key: "rg", label: "RG" },
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
          <PartnerEntityForm
            item={item}
            companyId={companyId}
            saving={saving}
            onCancel={onCancel}
            onSave={onSave}
          />
        )}
      />
    </div>
  );
}

function PartnerEntityForm({
  item,
  companyId,
  saving,
  onCancel,
  onSave,
}: {
  item: Partial<Partner> | null;
  companyId: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (data: Record<string, unknown>) => Promise<string | null>;
}) {
  const [docError, setDocError] = useState<string | null>(null);
  const [rgError, setRgError] = useState<string | null>(null);
  const { seedCode, codeReady } = useSeedNumericCode("partners", companyId, item);

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
        partner_type: item?.partner_type ?? "Socio",
        status: item?.status ?? "Ativo",
        use_in_allocation: item?.use_in_allocation ?? true,
        rg: item?.rg ?? "",
        cpf: item?.cpf ?? "",
        notes: item?.notes ?? "",
      }}
      onSubmit={async (data) => {
        const partnerType = String(data.partner_type ?? "Socio");
        const rgMsg = validatePartnerRg(partnerType, String(data.rg ?? ""));
        const docMsg = validatePartnerDocument(partnerType, String(data.cpf ?? ""));
        setRgError(rgMsg);
        setDocError(docMsg);
        if (rgMsg || docMsg) return;

        const resolved = resolveEntityNumericCode(data.code, { existingCode: item?.code });
        if (!resolved.ok) {
          window.alert("Informe um código numérico com até 8 dígitos (ex.: 00000001).");
          return;
        }
        data.code = resolved.code;

        const rgRaw = String(data.rg ?? "").trim();
        data.rg = partnerType === "Empresa" || !rgRaw ? null : formatRg(rgRaw);

        const docDigits = onlyDigits(String(data.cpf ?? ""));
        data.cpf = docDigits ? docDigits : null;

        await onSave(data);
      }}
    >
      {({ form, set }) => {
        const partnerType = String(form.partner_type ?? "Socio");
        const isEmpresa = partnerType === "Empresa";
        const kind = documentKindForPartnerType(partnerType);
        const docLabel = kind === "cnpj" ? "CNPJ" : "CPF";
        const docValue = String(form.cpf ?? "");
        const formattedDoc =
          kind === "cnpj" ? formatCnpj(docValue) : formatCpf(docValue);

        return (
          <>
            {rgError && <Alert variant="error">{rgError}</Alert>}
            {docError && <Alert variant="error">{docError}</Alert>}

            <NumericCodeField
              value={String(form.code ?? "")}
              onChange={(v) => set("code", v)}
            />

            <FormFields
              form={form}
              set={(key, value) => {
                if (key === "partner_type") {
                  setDocError(null);
                  setRgError(null);
                  set("cpf", "");
                  if (value === "Empresa") set("rg", "");
                }
                set(key, value);
              }}
              fields={[
                {
                  name: "name",
                  label: "Nome completo / Razão social",
                  required: true,
                  colSpan: 2,
                  placeholder: isEmpresa
                    ? "Razão social da empresa"
                    : "Nome completo do sócio",
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
                { name: "use_in_allocation", label: "Usar em rateio?", type: "checkbox" },
                { name: "notes", label: "Observações", type: "textarea", colSpan: 2 },
              ]}
            />

            <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-sm font-medium text-slate-700">
                Documentos
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {!isEmpresa ? (
                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-700">RG</span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Ex.: 12.345.678-9 ou SSP"
                      className={glassField()}
                      value={String(form.rg ?? "")}
                      onChange={(e) => {
                        const next = formatRg(e.target.value);
                        set("rg", next);
                        setRgError(validatePartnerRg(partnerType, next));
                      }}
                    />
                    <span className="text-xs text-slate-500">
                      5 a 14 caracteres alfanuméricos
                    </span>
                  </label>
                ) : null}

                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">{docLabel}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={kind === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00"}
                    className={glassField()}
                    value={formattedDoc}
                    onChange={(e) => {
                      const digits = onlyDigits(e.target.value).slice(
                        0,
                        kind === "cnpj" ? 14 : 11
                      );
                      set("cpf", digits);
                      setDocError(validatePartnerDocument(partnerType, digits));
                    }}
                  />
                  <span className="text-xs text-slate-500">
                    {kind === "cnpj"
                      ? "14 dígitos com validação dos verificadores"
                      : "11 dígitos com validação dos verificadores"}
                  </span>
                </label>
              </div>
            </fieldset>
          </>
        );
      }}
    </EntityForm>
  );
}

export default function SociosPage() {
  return (
    <Suspense fallback={null}>
      <SociosPageContent />
    </Suspense>
  );
}
