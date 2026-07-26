"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Alert, Badge } from "@/components/ui/Badge";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
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
import { formatDuplicateCodeError, isEntityCodeTaken, resolveEntityNumericCode } from "@/lib/codes";
import { useCompany } from "@/lib/company-context";
import { glassField } from "@/lib/liquid-glass-styles";
import { assertCriticalDeleteGate } from "@/lib/deletion-gate";
import { enqueueDeletionAlert } from "@/lib/deletion-alerts";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import { softDeletePartnerByCode } from "@/lib/partners";
import {
  documentLabelForDigits,
  formatDuplicateDocumentError,
  isPartyDocumentTaken,
} from "@/lib/party-document-uniqueness";
import { useSeedNumericCode } from "@/lib/use-seed-numeric-code";
import type { Partner } from "@/types/database";
import { PARTNER_TYPES, STATUS_OPTIONS } from "@/types/database";

function SociosPageContent() {
  const { companyId, loading: companyLoading } = useCompany();
  const { canDeleteScreen, isAdmin, loading: accessLoading } = useAccess();
  const canDelete = canDeleteScreen("cadastros.socios");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
  const [deletingByCode, setDeletingByCode] = useState(false);
  const [requireMasterForDelete, setRequireMasterForDelete] = useState(false);

  useEffect(() => {
    const deleteCode = searchParams.get("deleteCode");
    if (!deleteCode || companyLoading || accessLoading || !companyId) return;

    if (!canDelete) {
      router.replace("/cadastros/socios");
      setActionError("Seu acesso não inclui Exclusão nesta tela.");
      return;
    }

    setPendingDeleteCode(deleteCode);
    void (async () => {
      if (!isAdmin || !companyId) {
        setRequireMasterForDelete(false);
        return;
      }
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setRequireMasterForDelete(!(user?.id && isMasterSessionUnlocked(companyId, user.id)));
    })();
  }, [accessLoading, canDelete, companyId, companyLoading, isAdmin, router, searchParams]);

  return (
    <div className="space-y-4">
      {actionMsg && <Alert variant="info">{actionMsg}</Alert>}
      {actionError && <Alert variant="error">{actionError}</Alert>}

      <DeleteReasonModal
        open={Boolean(pendingDeleteCode)}
        confirming={deletingByCode}
        critical
        requireMasterPassword={requireMasterForDelete}
        confirmLabel={isAdmin ? "Excluir com registro" : "Enviar para aprovação"}
        title={`Excluir sócio ${pendingDeleteCode ?? ""}`}
        description="Informe o motivo. O sócio sai da lista ativa e o registro fica no Histórico de Exclusões."
        onCancel={() => {
          if (deletingByCode) return;
          setPendingDeleteCode(null);
          router.replace("/cadastros/socios");
        }}
        onConfirm={async (payload) => {
          if (!companyId || !pendingDeleteCode) return;
          setDeletingByCode(true);
          const { createClient } = await import("@/lib/supabase/client");
          const supabase = createClient();
          const gate = await assertCriticalDeleteGate({
            supabase,
            companyId,
            isAdmin,
            masterPassword: payload.masterPassword,
          });
          if (!gate.ok) {
            setDeletingByCode(false);
            setActionError(gate.error);
            return;
          }
          if (gate.mode === "approval") {
            setDeletingByCode(false);
            setPendingDeleteCode(null);
            router.replace("/cadastros/socios");
            setActionError(
              "Exclusão de sócio por link exige administrador com Senha Máster. Use Excluir na lista."
            );
            return;
          }
          const result = await softDeletePartnerByCode(companyId, pendingDeleteCode, {
            reason: payload.reason,
            reasonCode: payload.reasonCode,
          });
          setDeletingByCode(false);
          setPendingDeleteCode(null);
          router.replace("/cadastros/socios");
          if (result.ok) {
            await enqueueDeletionAlert({
              supabase,
              companyId,
              alertType: "critical_deleted",
              title: "Exclusão crítica: Sócio",
              body: `Sócio ${result.code} (${result.name}) excluído. Motivo: ${payload.reason}`,
              entityType: "partners",
            });
            setActionMsg(`Sócio ${result.code} (${result.name}) excluído com sucesso.`);
            setActionError(null);
            setRefreshKey((k) => k + 1);
          } else {
            setActionError(result.reason);
            setActionMsg(null);
          }
        }}
      />

      <CrudPage<Partner>
        key={refreshKey}
        title="Sócios"
        description="Código numérico sequencial de 8 dígitos (editável e único) · CPF/CNPJ único · RG"
        table="partners"
        auditScreenKey="cadastros.socios"
        orderBy="code"
        eqFilters={{ status: "Ativo" }}
        columns={[
          { key: "code", label: "Código" },
          { key: "name", label: "Nome completo" },
          { key: "cpf", label: "CPF/CNPJ", className: "hidden md:table-cell" },
          { key: "rg", label: "RG", className: "hidden lg:table-cell" },
          { key: "partner_type", label: "Tipo", className: "hidden lg:table-cell" },
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
            className: "hidden xl:table-cell",
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
  const [docDupError, setDocDupError] = useState<string | null>(null);
  const [codeDupError, setCodeDupError] = useState<string | null>(null);
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

        if (companyId) {
          const codeCheck = await isEntityCodeTaken(
            "partners",
            companyId,
            resolved.code,
            item?.id ?? null
          );
          if (codeCheck.taken) {
            setCodeDupError(formatDuplicateCodeError(resolved.code));
            return;
          }
        }
        setCodeDupError(null);

        const rgRaw = String(data.rg ?? "").trim();
        data.rg = partnerType === "Empresa" || !rgRaw ? null : formatRg(rgRaw);

        const docDigits = onlyDigits(String(data.cpf ?? ""));
        data.cpf = docDigits ? docDigits : null;

        if (docDigits && companyId) {
          const dup = await isPartyDocumentTaken("partners", companyId, docDigits, item?.id);
          if (dup.taken) {
            setDocDupError(formatDuplicateDocumentError(documentLabelForDigits(dup.digits)));
            return;
          }
        }
        setDocDupError(null);

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
            {docDupError && <Alert variant="error">{docDupError}</Alert>}
            {codeDupError && <Alert variant="error">{codeDupError}</Alert>}

            <NumericCodeField
              value={String(form.code ?? "")}
              onChange={(v) => {
                set("code", v);
                setCodeDupError(null);
              }}
              onBlur={async (code) => {
                if (!companyId || !code) return;
                const check = await isEntityCodeTaken(
                  "partners",
                  companyId,
                  code,
                  item?.id ?? null
                );
                setCodeDupError(check.taken ? formatDuplicateCodeError(code) : null);
              }}
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
                      setDocDupError(null);
                    }}
                    onBlur={async (e) => {
                      const digits = onlyDigits(e.target.value);
                      if (!digits || !companyId) return;
                      const dup = await isPartyDocumentTaken(
                        "partners",
                        companyId,
                        digits,
                        item?.id
                      );
                      setDocDupError(
                        dup.taken
                          ? formatDuplicateDocumentError(documentLabelForDigits(dup.digits))
                          : null
                      );
                    }}
                  />
                  <span className="text-xs text-slate-500">
                    {kind === "cnpj"
                      ? "14 dígitos · único por empresa"
                      : "11 dígitos · único por empresa"}
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
