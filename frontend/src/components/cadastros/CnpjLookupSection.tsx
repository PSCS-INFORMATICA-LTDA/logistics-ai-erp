"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCpfCnpj, onlyDigits } from "@/lib/br-documents";
import { cnpjInfoToFormPatch, fetchCompanyByCnpj } from "@/lib/cnpj";
import { glassField } from "@/lib/liquid-glass-styles";

type Props = {
  form: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  /** Se false, não altera o campo name (ex.: empresa usa razão social separado). */
  fillName?: boolean;
  fillPhone?: boolean;
  mapStatusToCadastro?: boolean;
  /** Se false, não renderiza o input de documento (já existe no formulário pai). */
  showDocumentInput?: boolean;
};

export function CnpjLookupSection({
  form,
  set,
  fillName = true,
  fillPhone = true,
  mapStatusToCadastro = true,
  showDocumentInput = true,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const documentValue = String(form.document ?? "");
  const digits = onlyDigits(documentValue);
  const canLookup = digits.length === 14;

  const applyLookup = async () => {
    setLoading(true);
    setError(null);
    setOkMessage(null);
    try {
      const info = await fetchCompanyByCnpj(documentValue);
      const patch = cnpjInfoToFormPatch(info, { fillName, fillPhone, mapStatusToCadastro });
      for (const [key, value] of Object.entries(patch)) {
        set(key, value);
      }
      setOkMessage(
        info.isActive
          ? "CNPJ ATIVO na Receita. Dados preenchidos — salve para gravar no banco."
          : `Situação na Receita: ${info.status}. Dados preenchidos — salve para gravar no banco.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar CNPJ.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 sm:col-span-2">
      <div>
        <p className="text-sm font-medium text-slate-800">Consulta CNPJ</p>
        <p className="text-xs text-slate-500">
          Com 14 dígitos, consulte razão social, endereço completo e se está ativa na Receita. A
          inscrição estadual (IE) pode ser preenchida manualmente — a base aberta da Receita não
          retorna IE.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {showDocumentInput ? (
          <label className="block min-w-0 flex-1 space-y-1">
            <span className="text-sm font-medium text-slate-700">CNPJ / CPF</span>
            <input
              className={glassField(false)}
              value={documentValue}
              onChange={(e) => {
                set("document", formatCpfCnpj(e.target.value));
                setError(null);
                setOkMessage(null);
              }}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              autoComplete="off"
            />
          </label>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-slate-600">
            Documento atual:{" "}
            <span className="font-medium text-slate-800">{documentValue || "—"}</span>
          </p>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={loading || !canLookup}
          onClick={() => void applyLookup()}
          className="shrink-0"
        >
          {loading ? "Consultando..." : "Consultar CNPJ"}
        </Button>
      </div>

      {digits.length > 0 && digits.length < 14 ? (
        <p className="text-xs text-amber-700">
          Digite o CNPJ completo (14 dígitos) para habilitar a consulta. CPF não consulta Receita.
        </p>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {okMessage ? <Alert variant="info">{okMessage}</Alert> : null}

      {form.cnpj_status ? (
        <p className="text-xs text-slate-600">
          Situação cadastral:{" "}
          <span className="font-semibold text-slate-800">{String(form.cnpj_status)}</span>
          {form.cnpj_checked_at
            ? ` · consultado em ${new Date(String(form.cnpj_checked_at)).toLocaleString("pt-BR")}`
            : null}
        </p>
      ) : null}
    </div>
  );
}
